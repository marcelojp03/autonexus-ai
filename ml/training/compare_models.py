"""Compare classification backbones under one protocol, then evaluate the winner once.

Protocol (the point of this script):

  * every candidate sees the *same* images, the same head, the same loss, the same epochs and the
    same thresholds policy (per-label F1 on the validation split);
  * the winner is selected **only with validation** metrics, never with the test split;
  * the test split is evaluated once, and additionally on the subset that survives the duplicate
    and capture-session audit;
  * size and CPU latency are measured for the full inference graph, because a backbone that is 2 %
    better but 5x slower is not a free win for web/mobile.

Candidates: MobileNetV2 frozen (current reference), MobileNetV2 fine-tuned on its last block,
MobileNetV3-Small and MobileNetV3-Large frozen.

Usage:
  python training/compare_models.py --subset 4000
  python training/compare_models.py --subset 4000 --final v3large-linear
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np

CLASSES = ["crack", "dent", "glass_shatter", "lamp_broken", "scratch", "tire_flat"]
KEYS = ["crack", "dent", "glass_shatter", "scratch"]
IMAGE_SIZE = 224
SEED = 20261101
MIN_TEST_SUPPORT = 40

CANDIDATES = {
    "v2-linear": {"application": "mobilenet_v2", "fine_tune": 0, "alpha": 1.0},
    "v2-finetune": {"application": "mobilenet_v2", "fine_tune": 40, "alpha": 1.0},
    "v3small-linear": {"application": "mobilenet_v3_small", "fine_tune": 0, "alpha": 1.0},
    "v3large-linear": {"application": "mobilenet_v3_large", "fine_tune": 0, "alpha": 1.0},
}


def load_rows(index: Path, split: str, raw: Path, subset: int, root: Path) -> tuple[list[Path], np.ndarray]:
    paths: list[Path] = []
    targets: list[list[int]] = []
    with (index / f"{split}.jsonl").open(encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            # Licensed negatives live under the data root, not inside the dataset snapshot.
            paths.append(root / row["image"] if row["image"].startswith("negatives/") else raw / row["image"])
            targets.append(row["labels"])
    kept = [CLASSES.index(key) for key in KEYS]
    paths = paths[:]
    matrix = np.asarray(targets, dtype=np.int8)[:, kept]
    if subset and subset < len(paths):
        # Deterministic stride keeps the class mix instead of taking an alphabetical head.
        stride = len(paths) / subset
        selection = [int(i * stride) for i in range(subset)]
        paths = [paths[i] for i in selection]
        matrix = matrix[selection]
    return paths, matrix


def preprocess(path) -> np.ndarray:
    import tensorflow as tf

    raw = tf.io.read_file(path)
    image = tf.io.decode_jpeg(raw, channels=3)
    image = tf.image.resize(image, (IMAGE_SIZE, IMAGE_SIZE), method="bilinear")
    return tf.keras.applications.mobilenet_v2.preprocess_input(tf.cast(image, tf.float32))


def make_base(spec: dict, pretrained: bool = True):
    from tensorflow.keras.applications import MobileNetV2, MobileNetV3Large, MobileNetV3Small

    factories = {"mobilenet_v2": MobileNetV2, "mobilenet_v3_small": MobileNetV3Small, "mobilenet_v3_large": MobileNetV3Large}
    factory = factories[spec["application"]]
    return factory(
        input_shape=(IMAGE_SIZE, IMAGE_SIZE, 3),
        include_top=False,
        pooling="avg",
        weights="imagenet" if pretrained else None,
    )


def features_for(base, paths, cache: Path, batch: int) -> np.ndarray:
    import tensorflow as tf

    if cache.exists():
        return np.load(cache)["features"]
    dataset = (
        tf.data.Dataset.from_tensor_slices([str(path) for path in paths])
        .map(preprocess, num_parallel_calls=tf.data.AUTOTUNE, deterministic=False)
        .batch(batch)
        .prefetch(tf.data.AUTOTUNE)
    )
    values = base.predict(dataset, verbose=0)
    cache.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(cache, features=values.astype(np.float32))
    return values


def train_head(features: np.ndarray, targets: np.ndarray, validation, epochs: int):
    import tensorflow as tf
    from tensorflow import keras

    positives = targets.sum(axis=0)
    negatives = targets.shape[0] - positives
    weights = np.array([float(np.clip(negatives[i] / max(positives[i], 1), 1.0, 25.0)) for i in range(len(KEYS))], dtype="float32")
    head = keras.Sequential(
        [
            keras.Input(shape=(features.shape[1],), name="features"),
            keras.layers.Dropout(0.2, seed=SEED),
            keras.layers.Dense(len(KEYS), activation="sigmoid", name="damage_labels"),
        ],
        name="head",
    )
    tensor = tf.constant(weights)

    def weighted_bce(y_true, y_pred):
        return tf.reduce_mean(keras.backend.binary_crossentropy(y_true, y_pred) * tensor)

    head.compile(optimizer=keras.optimizers.Adam(1e-3), loss=weighted_bce, metrics=[keras.metrics.AUC(name="auc", multi_label=True, num_labels=len(KEYS))])
    head.fit(
        features,
        targets,
        validation_data=validation,
        epochs=epochs,
        batch_size=256,
        callbacks=[keras.callbacks.EarlyStopping(monitor="val_loss", patience=6, restore_best_weights=True, verbose=0)],
        verbose=0,
    )
    return head


def choose_thresholds(probabilities: np.ndarray, targets: np.ndarray) -> dict[str, float]:
    from sklearn.metrics import f1_score

    thresholds = {}
    for index, name in enumerate(KEYS):
        column = targets[:, index]
        if column.sum() == 0:
            thresholds[name] = 0.5
            continue
        best, best_threshold = -1.0, 0.5
        for candidate in np.arange(0.05, 0.96, 0.05):
            predicted = (probabilities[:, index] >= candidate).astype(int)
            score = f1_score(column, predicted, zero_division=0)
            if score > best:
                best, best_threshold = score, round(float(candidate), 2)
        thresholds[name] = best_threshold
    return thresholds


def metrics(probabilities: np.ndarray, targets: np.ndarray, thresholds: dict[str, float]) -> dict:
    from sklearn.metrics import precision_recall_fscore_support, roc_auc_score

    per_label = {}
    for index, name in enumerate(KEYS):
        predicted = (probabilities[:, index] >= thresholds[name]).astype(int)
        truth = targets[:, index]
        precision, recall, f1, _ = precision_recall_fscore_support(truth, predicted, average="binary", zero_division=0)
        try:
            auc = round(float(roc_auc_score(truth, probabilities[:, index])), 4)
        except ValueError:
            auc = None
        per_label[name] = {"precision": round(float(precision), 4), "recall": round(float(recall), 4), "f1": round(float(f1), 4), "rocAuc": auc, "support": int(truth.sum())}
    return {
        "samples": int(targets.shape[0]),
        "perLabel": per_label,
        "macroF1": round(float(np.mean([per_label[name]["f1"] for name in KEYS])), 4),
        "macroRecall": round(float(np.mean([per_label[name]["recall"] for name in KEYS])), 4),
    }


def build_inference(application: str, head):
    from tensorflow import keras

    base = make_base({"application": application})
    image_input = keras.Input(shape=(IMAGE_SIZE, IMAGE_SIZE, 3), name="image")
    pooled = base(image_input)
    dropped = keras.layers.Dropout(0.2, seed=SEED)(pooled)
    outputs = head.get_layer("damage_labels")(dropped)
    model = keras.Model(inputs=image_input, outputs=outputs, name=application)
    return model


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="/work/data")
    parser.add_argument("--artifacts", default="/work/artifacts")
    parser.add_argument("--subset", type=int, default=4000)
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument("--only", default="", help="comma separated candidate names")
    parser.add_argument("--final", default="", help="candidate to evaluate once on the test split")
    args = parser.parse_args()

    import tensorflow as tf
    from tensorflow import keras

    keras.utils.set_random_seed(SEED)
    root = Path(args.root)
    dataset = json.loads((root / "dataset.json").read_text(encoding="utf-8"))
    raw = Path(dataset["localPath"])
    if not raw.exists():
        raw = root / "raw" / dataset["name"].replace("/", "__")
    index = root / "index"

    splits = {split: load_rows(index, split, raw, args.subset, root) for split in ("train", "validation", "test")}
    report_path = Path(args.artifacts) / "comparison.json"
    report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else {"subset": args.subset, "protocol": "same images, same head, same loss; winner by validation only", "candidates": {}}
    report["subset"] = args.subset

    names = [name.strip() for name in args.only.split(",") if name.strip()] or list(CANDIDATES)
    for name in names:
        spec = CANDIDATES[name]
        started = time.perf_counter()
        if spec["fine_tune"]:
            base = make_base(spec)
            base.trainable = True
            for layer in base.layers[: -spec["fine_tune"]]:
                layer.trainable = False
            model = keras.Sequential([keras.Input(shape=(IMAGE_SIZE, IMAGE_SIZE, 3), name="image"), base, keras.layers.Dropout(0.2, seed=SEED), keras.layers.Dense(len(KEYS), activation="sigmoid", name="damage_labels")], name=name)
            model.compile(optimizer=keras.optimizers.Adam(1e-4), loss="binary_crossentropy")
            train_ds = (
                tf.data.Dataset.from_tensor_slices(([str(p) for p in splits["train"][0]], splits["train"][1]))
                .map(lambda path, label: (preprocess(path), label), num_parallel_calls=tf.data.AUTOTUNE, deterministic=False)
                .batch(32)
                .prefetch(tf.data.AUTOTUNE)
            )
            val_ds = (
                tf.data.Dataset.from_tensor_slices(([str(p) for p in splits["validation"][0]], splits["validation"][1]))
                .map(lambda path, label: (preprocess(path), label), num_parallel_calls=tf.data.AUTOTUNE, deterministic=False)
                .batch(32)
                .prefetch(tf.data.AUTOTUNE)
            )
            model.fit(train_ds, validation_data=val_ds, epochs=6, callbacks=[keras.callbacks.EarlyStopping(monitor="val_loss", patience=2, restore_best_weights=True)], verbose=0)
            validation_probabilities = model.predict(val_ds, verbose=0)
            inference = model
            head = None
        else:
            base = make_base(spec)
            cache = root / "features" / f"cmp-{name}-{args.subset}-{len(splits['train'][0])}.npz"
            train_features = features_for(base, splits["train"][0], cache, args.batch)
            validation_features = features_for(base, splits["validation"][0], root / "features" / f"cmp-{name}-validation-{args.subset}.npz", args.batch)
            head = train_head(train_features, splits["train"][1], (validation_features, splits["validation"][1]), args.epochs)
            validation_probabilities = head.predict(validation_features, verbose=0)
            inference = None

        thresholds = choose_thresholds(validation_probabilities, splits["validation"][1])
        validation_metrics = metrics(validation_probabilities, splits["validation"][1], thresholds)

        # Latency and size of the full graph, batch 1, CPU.
        if inference is None:
            inference = build_inference(spec["application"], head)
        sample = preprocess(str(splits["validation"][0][0]))[None, ...]
        inference.predict(sample, verbose=0)
        timings = []
        for _ in range(12):
            begin = time.perf_counter()
            inference.predict(sample, verbose=0)
            timings.append((time.perf_counter() - begin) * 1000)

        report["candidates"][name] = {
            "application": spec["application"],
            "fineTuneLayers": spec["fine_tune"],
            "parameters": int(inference.count_params()),
            "float32Bytes": int(inference.count_params() * 4),
            "latencyMsMedian": round(float(np.median(timings)), 1),
            "validation": validation_metrics,
            "thresholds": thresholds,
            "trainSeconds": round(time.perf_counter() - started, 1),
        }
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps({"candidate": name, "validation": validation_metrics["macroF1"], "latencyMs": report["candidates"][name]["latencyMsMedian"], "params": report["candidates"][name]["parameters"]}))

    if args.final:
        name = args.final
        entry = report["candidates"][name]
        spec = CANDIDATES[name]
        # Rebuild the winner on the *training* split only, then evaluate the test split once.
        if spec["fine_tune"]:
            report["final"] = {"candidate": name, "status": "skipped", "reason": "fine-tuned candidate requires the image pipeline; run --final after retraining with train.py settings"}
        else:
            base = make_base(spec)
            cache = root / "features" / f"cmp-{name}-{args.subset}-{len(splits['train'][0])}.npz"
            train_features = features_for(base, splits["train"][0], cache, args.batch)
            head = train_head(train_features, splits["train"][1], (features_for(base, splits["validation"][0], root / "features" / f"cmp-{name}-validation-{args.subset}.npz", args.batch), splits["validation"][1]), args.epochs)
            test_features = features_for(base, splits["test"][0], root / "features" / f"cmp-{name}-test-{args.subset}.npz", args.batch)
            probabilities = head.predict(test_features, verbose=0)
            report["final"] = {"candidate": name, "test": metrics(probabilities, splits["test"][1], entry["thresholds"]), "note": "evaluated once on the full test split with thresholds fixed on validation"}
            report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
            print(json.dumps({"final": name, "test": report["final"]["test"]["macroF1"]}))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
