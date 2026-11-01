"""Train the CU23 automotive damage head on top of a frozen MobileNetV2 extractor.

Contract kept by this script (see docs/compose/spec/cu23-visual-intelligence.md S2.2):
  * base weights are Keras Applications MobileNetV2/ImageNet (Apache-2.0), versioned by hash;
  * the trained head is small, so the exported artefact stays convertible to TensorFlow.js and
    LiteRT for CU22;
  * thresholds are selected on the validation split only; the test split is evaluated once;
  * a label is kept only when the test split can actually support it (>= 40 positives). Labels the
    published dataset cannot evaluate are dropped from the artefact instead of being shipped as an
    unmeasured capability;
  * every number printed here comes from this run - nothing is estimated or reused.

Usage (inside the ml image, repo ``ml`` directory mounted at /work):
    python training/train.py --epochs 40
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

CLASSES = ["crack", "dent", "glass_shatter", "lamp_broken", "scratch", "tire_flat"]
MODEL_VERSION = "automotive-damage-mobilenetv2-v1"
IMAGE_SIZE = 224
SEED = 20261101
MIN_TEST_SUPPORT = 40
BASE_WEIGHTS = "https://storage.googleapis.com/tensorflow/keras-applications/mobilenet_v2/mobilenet_v2_weights_tf_dim_ordering_tf_kernels_1.0_224_no_top.h5"


def sha256_of(path: Path) -> str | None:
    if not path.exists():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_rows(index: Path, split: str, raw: Path) -> tuple[list[Path], np.ndarray]:
    paths: list[Path] = []
    targets: list[list[int]] = []
    with (index / f"{split}.jsonl").open(encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            paths.append(raw / row["image"])
            targets.append(row["labels"])
    return paths, np.asarray(targets, dtype=np.int8)


def preprocess(image_path) -> np.ndarray:
    import tensorflow as tf

    raw = tf.io.read_file(image_path)
    image = tf.io.decode_jpeg(raw, channels=3)
    image = tf.image.resize(image, (IMAGE_SIZE, IMAGE_SIZE), method="bilinear")
    return tf.keras.applications.mobilenet_v2.preprocess_input(tf.cast(image, tf.float32))


def extract_features(base, paths: list[Path], cache: Path, batch: int) -> np.ndarray:
    import tensorflow as tf

    if cache.exists():
        return np.load(cache)["features"]
    dataset = (
        tf.data.Dataset.from_tensor_slices([str(path) for path in paths])
        .map(preprocess, num_parallel_calls=tf.data.AUTOTUNE, deterministic=False)
        .batch(batch)
        .prefetch(tf.data.AUTOTUNE)
    )
    features = base.predict(dataset, verbose=2)
    cache.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(cache, features=features.astype(np.float32))
    return features


def choose_thresholds(probabilities: np.ndarray, targets: np.ndarray, labels: list[str]) -> dict[str, float]:
    from sklearn.metrics import f1_score

    thresholds: dict[str, float] = {}
    for index, name in enumerate(labels):
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


def evaluate(probabilities: np.ndarray, targets: np.ndarray, thresholds: dict[str, float], labels: list[str]) -> dict:
    from sklearn.metrics import average_precision_score, confusion_matrix, f1_score, precision_recall_fscore_support, roc_auc_score

    per_label = {}
    for index, name in enumerate(labels):
        threshold = thresholds[name]
        predicted = (probabilities[:, index] >= threshold).astype(int)
        truth = targets[:, index]
        precision, recall, f1, _ = precision_recall_fscore_support(truth, predicted, average="binary", zero_division=0)
        matrix = confusion_matrix(truth, predicted, labels=[0, 1]).tolist()
        try:
            auc = float(roc_auc_score(truth, probabilities[:, index]))
        except ValueError:
            auc = None
        per_label[name] = {
            "threshold": threshold,
            "support": int(truth.sum()),
            "precision": round(float(precision), 4),
            "recall": round(float(recall), 4),
            "f1": round(float(f1), 4),
            "rocAuc": None if auc is None else round(auc, 4),
            "averagePrecision": round(float(average_precision_score(truth, probabilities[:, index])), 4) if truth.sum() else None,
            "confusionMatrix": {"labels": ["absent", "present"], "matrix": matrix},
        }

    predicted_labels = np.stack([(probabilities[:, i] >= thresholds[name]).astype(int) for i, name in enumerate(labels)], axis=1)
    exact_match = float((predicted_labels == targets).all(axis=1).mean())
    any_damage_truth = (targets.max(axis=1) == 1).astype(int)
    any_damage_predicted = (predicted_labels.max(axis=1) == 1).astype(int)
    any_damage_f1 = f1_score(any_damage_truth, any_damage_predicted, zero_division=0)

    macro = {
        "precision": round(float(np.mean([per_label[name]["precision"] for name in labels])), 4),
        "recall": round(float(np.mean([per_label[name]["recall"] for name in labels])), 4),
        "f1": round(float(np.mean([per_label[name]["f1"] for name in labels])), 4),
    }
    return {
        "samples": int(targets.shape[0]),
        "perLabel": per_label,
        "macro": macro,
        "exactMatchRatio": round(exact_match, 4),
        "anyDamageF1": round(float(any_damage_f1), 4),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="/work/data")
    parser.add_argument("--artifacts", default="/work/artifacts")
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--batch", type=int, default=32)
    args = parser.parse_args()

    import tensorflow as tf
    from tensorflow import keras

    keras.utils.set_random_seed(SEED)

    root = Path(args.root)
    index = root / "index"
    dataset = json.loads((root / "dataset.json").read_text(encoding="utf-8"))
    raw = Path(dataset["localPath"])
    if not raw.exists():
        raw = root / "raw" / dataset["name"].replace("/", "__")

    splits = {split: load_rows(index, split, raw) for split in ("train", "validation", "test")}

    # Keep only labels the evaluation split can support; the rest are reported, not shipped.
    test_positives = splits["test"][1].sum(axis=0)
    kept = [i for i in range(len(CLASSES)) if int(test_positives[i]) >= MIN_TEST_SUPPORT]
    dropped = {CLASSES[i]: int(test_positives[i]) for i in range(len(CLASSES)) if i not in kept}
    labels = [CLASSES[i] for i in kept]
    if not labels:
        raise SystemExit("no label reaches the minimum evaluation support")
    splits = {split: (paths, targets[:, kept]) for split, (paths, targets) in splits.items()}

    weights_file = Path.home() / ".keras" / "models" / "mobilenet_v2_weights_tf_dim_ordering_tf_kernels_1.0_224_no_top.h5"
    base = keras.applications.MobileNetV2(input_shape=(IMAGE_SIZE, IMAGE_SIZE, 3), include_top=False, pooling="avg", weights="imagenet")
    base_sha = sha256_of(weights_file)

    features = {
        split: extract_features(base, paths, root / "features" / f"{MODEL_VERSION}-{split}.npz", args.batch)
        for split, (paths, _) in splits.items()
    }

    positives = splits["train"][1].sum(axis=0)
    negatives = splits["train"][1].shape[0] - positives
    class_weight = np.array([float(np.clip(negatives[i] / max(positives[i], 1), 1.0, 25.0)) for i in range(len(labels))], dtype="float32")

    head = keras.Sequential(
        [
            keras.Input(shape=(features["train"].shape[1],), name="mobilenet_v2_features"),
            keras.layers.Dropout(0.2, seed=SEED),
            keras.layers.Dense(len(labels), activation="sigmoid", name="damage_labels"),
        ],
        name="damage_head",
    )
    weights = tf.constant(class_weight, dtype=tf.float32)

    def weighted_bce(y_true, y_pred):
        # Per-label positive weighting keeps rare classes learnable without duplicating images or
        # changing the published preprocessing.
        return tf.reduce_mean(keras.backend.binary_crossentropy(y_true, y_pred) * weights)

    head.compile(
        optimizer=keras.optimizers.Adam(1e-3),
        loss=weighted_bce,
        metrics=[keras.metrics.AUC(name="auc", multi_label=True, num_labels=len(labels))],
    )

    history = head.fit(
        features["train"],
        splits["train"][1],
        validation_data=(features["validation"], splits["validation"][1]),
        epochs=args.epochs,
        batch_size=256,
        callbacks=[keras.callbacks.EarlyStopping(monitor="val_loss", patience=6, restore_best_weights=True, verbose=1)],
        verbose=2,
    )

    validation_probabilities = head.predict(features["validation"], verbose=0)
    thresholds = choose_thresholds(validation_probabilities, splits["validation"][1], labels)
    test_probabilities = head.predict(features["test"], verbose=0)
    test_metrics = evaluate(test_probabilities, splits["test"][1], thresholds, labels)
    validation_metrics = evaluate(validation_probabilities, splits["validation"][1], thresholds, labels)

    # Inference artefact: a plain Functional graph over the same base and a *fresh* head that only
    # receives the trained weights. The compiled head is not serialised, so loading the artefact
    # cannot fail on a custom loss function.
    image_input = keras.Input(shape=(IMAGE_SIZE, IMAGE_SIZE, 3), name="image")
    pooled = base(image_input)
    export_dropped = keras.layers.Dropout(0.2, seed=SEED)(pooled)
    outputs = keras.layers.Dense(len(labels), activation="sigmoid", name="damage_labels")(export_dropped)
    model = keras.Model(inputs=image_input, outputs=outputs, name=MODEL_VERSION)
    model.get_layer("damage_labels").set_weights(head.get_layer("damage_labels").get_weights())
    model.trainable = False

    artifacts = Path(args.artifacts) / MODEL_VERSION
    artifacts.mkdir(parents=True, exist_ok=True)
    model_path = artifacts / "model.keras"
    model.save(model_path)

    manifest = {
        "modelVersion": MODEL_VERSION,
        "task": "automotive-surface-damage-multilabel",
        "labels": labels,
        "thresholds": thresholds,
        "preprocessing": {
            "inputSize": [IMAGE_SIZE, IMAGE_SIZE],
            "colorMode": "RGB",
            "resize": "bilinear",
            "scale": "keras.applications.mobilenet_v2.preprocess_input ([-1, 1])",
            "decoder": "JPEG/PNG via Pillow or tf.io.decode_image",
        },
        "architecture": {
            "base": "MobileNetV2 (include_top=False, pooling=avg, alpha=1.0)",
            "baseWeights": "imagenet",
            "baseWeightsUrl": BASE_WEIGHTS,
            "baseWeightsSha256": base_sha,
            "head": f"Dropout(0.2) -> Dense({len(labels)}, sigmoid)",
            "trainableParameters": int(head.count_params()),
        },
        "runtime": {"expectedFile": "model.keras", "framework": "tensorflow-cpu 2.16.2 / keras", "entrypoint": "keras.models.load_model"},
        "dataset": {
            "name": dataset["name"],
            "url": dataset["url"],
            "license": dataset["license"],
            "revision": dataset["revision"],
            "upstreamSources": dataset["upstreamSources"],
            "provenanceNote": dataset["provenanceNote"],
            "pairing": "only stems present in both images/ and labels/ (ml/training/collect_pairs.mjs)",
            "splits": {
                split: {"images": len(paths), "positives": dict(zip(labels, split_targets.sum(axis=0).astype(int).tolist()))}
                for split, (paths, split_targets) in splits.items()
            },
            "labelsDroppedForInsufficientTestSupport": dropped,
        },
        "training": {
            "seed": SEED,
            "epochs": args.epochs,
            "epochsRun": len(history.history["loss"]),
            "batchSize": args.batch,
            "optimizer": "Adam(1e-3)",
            "loss": "per-label weighted binary crossentropy",
            "classWeight": {name: round(float(class_weight[i]), 3) for i, name in enumerate(labels)},
            "thresholdSelection": "per-label F1 maximisation on the validation split",
            "frozenBase": True,
            "minimumTestSupport": MIN_TEST_SUPPORT,
        },
        "metrics": {"test": test_metrics, "validation": validation_metrics},
        "trainedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "limits": [
            "Image-level signal derived from detection annotations; it is not a measurement, a diagnosis or a repair estimate.",
            "Labels are inherited from an aggregated third-party dataset (CarDD, VehiDE, HITL GPT-4o); per-image vehicle identity is unknown, so the test split is not guaranteed vehicle-disjoint.",
            "No labels were annotated by this project; the model only recognises the labels listed here.",
            "Labels without enough positives in the evaluation split were dropped and are listed in dataset.labelsDroppedForInsufficientTestSupport.",
        ],
    }

    def _audit(value, path=""):
        if isinstance(value, dict):
            for key, item in value.items(): _audit(item, path + "/" + str(key))
        elif isinstance(value, (list, tuple)):
            for index, item in enumerate(value): _audit(item, path + "[" + str(index) + "]")
        elif not isinstance(value, (str, int, float, bool)) and value is not None:
            raise TypeError("non-json manifest value at " + path + ": " + type(value).__name__)

    _audit(manifest)
    (artifacts / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (artifacts / "metrics.json").write_text(
        json.dumps(
            {
                "test": test_metrics,
                "validation": validation_metrics,
                "history": {key: [float(value) for value in values] for key, values in history.history.items()},
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(json.dumps({
        "modelVersion": MODEL_VERSION,
        "labels": labels,
        "dropped": dropped,
        "modelSizeBytes": model_path.stat().st_size,
        "testMacro": test_metrics["macro"],
        "anyDamageF1": test_metrics["anyDamageF1"],
        "thresholds": thresholds,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
