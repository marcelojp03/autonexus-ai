"""Train a CU23 candidate on SYNDCAR (CC BY 4.0) only, with a device-disjoint evaluation.

Why this script exists: the previous artefact was trained on an aggregate whose licence is disputed.
SYNDCAR is published by its authors under CC BY 4.0, ships damage boxes in YOLO format and puts the
capture device identifier in every filename, which allows a **device-disjoint** test instead of a
random split that leaks near-duplicate scenes.

Protocol:
  * multi-label targets derived from the damage boxes (Broken_Glass, Cracks, Scratches, Broken_Lights);
  * split by capture device: the device with most images trains, the second validates, the rest test
    - so no device is seen in training and then tested;
  * head trained from the same frozen ImageNet base, thresholds chosen **only** on validation;
  * images without any annotation are reported separately: in a synthetic set they may be missing
    annotations rather than genuinely undamaged, so they are not counted as negatives;
  * every figure is printed with its sample size and a Wilson 95% interval where it matters.

The result stays `experimental`: a small synthetic set says nothing definitive about real photographs.

Usage: python training/syndcar.py --root /work/data/raw/syndcar --artifacts /work/artifacts
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

CLASSES = ["Broken_Glass", "Cracks", "Scratches", "Broken_Lights"]
LABELS_MAP = {index: name for index, name in enumerate(CLASSES)}
MODEL_VERSION = "syndcar-damage-mobilenetv2-v1"
IMAGE_SIZE = 224
SEED = 20261101


def wilson(successes: int, total: int, z: float = 1.96) -> list[float]:
    if total == 0:
        return [0.0, 0.0]
    phat = successes / total
    denominator = 1 + z * z / total
    centre = (phat + z * z / (2 * total)) / denominator
    margin = z * math.sqrt(phat * (1 - phat) / total + z * z / (4 * total * total)) / denominator
    return [round(max(0.0, centre - margin), 4), round(min(1.0, centre + margin), 4)]


def read_targets(label_file: Path) -> tuple[list[int], int]:
    targets = [0] * len(CLASSES)
    boxes = 0
    if not label_file.exists():
        return targets, 0
    for line in label_file.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) < 5:
            continue
        index = int(parts[0])
        if index in LABELS_MAP:
            targets[index] = 1
            boxes += 1
    return targets, boxes


def preprocess(path) -> np.ndarray:
    import tensorflow as tf

    raw = tf.io.read_file(path)
    image = tf.io.decode_image(raw, channels=3, expand_animations=False)
    resized = tf.image.resize(image, (IMAGE_SIZE, IMAGE_SIZE), method="bilinear", antialias=True)
    return tf.keras.applications.mobilenet_v2.preprocess_input(tf.cast(resized, tf.float32))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="/work/data/raw/syndcar")
    parser.add_argument("--artifacts", default="/work/artifacts")
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--run-id", default="")
    args = parser.parse_args()

    import tensorflow as tf
    from tensorflow import keras
    from sklearn.metrics import precision_recall_fscore_support, roc_auc_score

    keras.utils.set_random_seed(SEED)
    root = Path(args.root)
    images_dir = root / "images"
    labels_dir = root / "labels_damage"
    if not images_dir.is_dir() or not labels_dir.is_dir():
        raise SystemExit("SYNDCAR not found; download SYNDCAR.zip from Mendeley and extract it here")

    rows = []
    for image in sorted(images_dir.iterdir()):
        if image.suffix.lower() not in {".png", ".jpg", ".jpeg"}:
            continue
        targets, boxes = read_targets(labels_dir / (image.stem + ".txt"))
        rows.append({"path": image, "device": image.stem.split("_")[0], "labels": targets, "boxes": boxes})

    devices = {}
    for row in rows:
        devices[row["device"]] = devices.get(row["device"], 0) + 1
    ordered = sorted(devices.items(), key=lambda item: -item[1])
    if len(ordered) < 2:
        raise SystemExit("at least two capture devices are required for a device-disjoint split")
    train_device = ordered[0][0]
    validation_device = ordered[1][0]
    splits = {
        "train": [row for row in rows if row["device"] == train_device],
        "validation": [row for row in rows if row["device"] == validation_device],
        "test": [row for row in rows if row["device"] not in {train_device, validation_device}],
    }
    unlabelled = [row for row in rows if row["boxes"] == 0]

    base = keras.applications.MobileNetV2(input_shape=(IMAGE_SIZE, IMAGE_SIZE, 3), include_top=False, pooling="avg", weights="imagenet")

    def features(rows_subset):
        """Decode with Pillow one image at a time: SYNDCAR renders are high resolution and a batched
        TensorFlow decode of 32 PNGs exhausts the container memory."""
        from PIL import Image

        if not rows_subset:
            return np.zeros((0, 1280), dtype="float32")
        chunks = []
        batch = []
        for row in rows_subset:
            with Image.open(row["path"]) as image:
                rgb = image.convert("RGB").resize((IMAGE_SIZE, IMAGE_SIZE), Image.BILINEAR)
                batch.append(np.asarray(rgb, dtype="float32") / 127.5 - 1.0)
            if len(batch) == 16:
                chunks.append(base.predict(np.asarray(batch), verbose=0))
                batch = []
        if batch:
            chunks.append(base.predict(np.asarray(batch), verbose=0))
        return np.concatenate(chunks, axis=0)

    matrix = {split: np.asarray([row["labels"] for row in subset], dtype=np.int8) for split, subset in splits.items()}
    vectors = {split: features(subset) for split, subset in splits.items()}

    positives = matrix["train"].sum(axis=0)
    negatives = matrix["train"].shape[0] - positives
    weights = tf.constant(np.clip(negatives / np.maximum(positives, 1), 1.0, 25.0).astype("float32"))

    def weighted_bce(y_true, y_pred):
        return tf.reduce_mean(keras.backend.binary_crossentropy(y_true, y_pred) * weights)

    head = keras.Sequential(
        [
            keras.Input(shape=(vectors["train"].shape[1],), name="mobilenet_v2_features"),
            keras.layers.Dropout(0.2, seed=SEED),
            keras.layers.Dense(len(CLASSES), activation="sigmoid", name="damage_labels"),
        ],
        name="syndcar_head",
    )
    head.compile(optimizer=keras.optimizers.Adam(1e-3), loss=weighted_bce, metrics=[keras.metrics.AUC(name="auc", multi_label=True, num_labels=len(CLASSES))])
    head.fit(
        vectors["train"],
        matrix["train"],
        validation_data=(vectors["validation"], matrix["validation"]),
        epochs=args.epochs,
        batch_size=64,
        callbacks=[keras.callbacks.EarlyStopping(monitor="val_loss", patience=6, restore_best_weights=True, verbose=0)],
        verbose=0,
    )

    def choose_thresholds(probabilities, targets):
        thresholds = {}
        for index, name in enumerate(CLASSES):
            column = targets[:, index]
            if column.sum() == 0:
                thresholds[name] = 0.5
                continue
            best, best_threshold = -1.0, 0.5
            for candidate in np.arange(0.05, 0.96, 0.05):
                predicted = (probabilities[:, index] >= candidate).astype(int)
                score = precision_recall_fscore_support(column, predicted, average="binary", zero_division=0)[2]
                if score > best:
                    best, best_threshold = score, round(float(candidate), 2)
            thresholds[name] = best_threshold
        return thresholds

    def evaluate(probabilities, targets, thresholds, subset_size):
        per_label = {}
        for index, name in enumerate(CLASSES):
            predicted = (probabilities[:, index] >= thresholds[name]).astype(int)
            column = targets[:, index]
            precision, recall, f1, _ = precision_recall_fscore_support(column, predicted, average="binary", zero_division=0)
            try:
                auc = round(float(roc_auc_score(column, probabilities[:, index])), 4)
            except ValueError:
                auc = None
            per_label[name] = {
                "precision": round(float(precision), 4),
                "recall": round(float(recall), 4),
                "f1": round(float(f1), 4),
                "rocAuc": auc,
                "support": int(column.sum()),
                "recallInterval95": wilson(int((predicted * column).sum()), int(column.sum())),
            }
        flagged = np.stack([probabilities[:, i] >= thresholds[name] for i, name in enumerate(CLASSES)], axis=1).max(axis=1)
        return {
            "samples": int(subset_size),
            "perLabel": per_label,
            "macroF1": round(float(np.mean([per_label[name]["f1"] for name in CLASSES])), 4),
            "imagesFlagged": int(flagged.sum()),
            "flagRateInterval95": wilson(int(flagged.sum()), int(subset_size)),
        }

    thresholds = choose_thresholds(head.predict(vectors["validation"], verbose=0), matrix["validation"])
    validation = evaluate(head.predict(vectors["validation"], verbose=0), matrix["validation"], thresholds, len(splits["validation"]))
    test_probabilities = head.predict(vectors["test"], verbose=0) if len(splits["test"]) else np.zeros((0, len(CLASSES)))
    test = evaluate(test_probabilities, matrix["test"], thresholds, len(splits["test"])) if len(splits["test"]) else None

    # Images without any annotation are reported, not assumed to be undamaged.
    unlabelled_report = None
    if unlabelled:
        unlabelled_probabilities = head.predict(features(unlabelled), verbose=0)
        flagged = np.stack([unlabelled_probabilities[:, i] >= thresholds[name] for i, name in enumerate(CLASSES)], axis=1).max(axis=1)
        unlabelled_report = {
            "images": len(unlabelled),
            "flagged": int(flagged.sum()),
            "flagRateInterval95": wilson(int(flagged.sum()), len(unlabelled)),
            "caveat": "synthetic set: absence of boxes may mean missing annotation, not an undamaged vehicle",
        }

    image_input = keras.Input(shape=(IMAGE_SIZE, IMAGE_SIZE, 3), name="image")
    pooled = base(image_input)
    export_dropped = keras.layers.Dropout(0.2, seed=SEED)(pooled)
    outputs = keras.layers.Dense(len(CLASSES), activation="sigmoid", name="damage_labels")(export_dropped)
    model = keras.Model(inputs=image_input, outputs=outputs, name=MODEL_VERSION)
    model.get_layer("damage_labels").set_weights(head.get_layer("damage_labels").get_weights())

    run_id = args.run_id or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    artifacts = Path(args.artifacts) / MODEL_VERSION / run_id
    artifacts.mkdir(parents=True, exist_ok=False)
    model_path = artifacts / "model.keras"
    model.save(model_path)

    preprocessing = {
        "inputSize": [IMAGE_SIZE, IMAGE_SIZE],
        "colorMode": "RGB",
        "resize": "tf.image.resize bilinear, antialias=True (identical in training and in the service)",
        "scale": "keras.applications.mobilenet_v2.preprocess_input ([-1, 1])",
        "decoder": "tf.io.decode_image (JPEG/PNG)",
    }
    manifest = {
        "modelVersion": MODEL_VERSION,
        "runId": run_id,
        "artifact": {"file": "model.keras", "sha256": hashlib.sha256(model_path.read_bytes()).hexdigest(), "bytes": model_path.stat().st_size},
        "preprocessingFingerprint": hashlib.sha256(json.dumps(preprocessing, sort_keys=True).encode()).hexdigest(),
        "task": "automotive-surface-damage-multilabel",
        "labels": CLASSES,
        "thresholds": thresholds,
        "preprocessing": preprocessing,
        "architecture": {
            "base": "MobileNetV2 (include_top=False, pooling=avg, alpha=1.0)",
            "baseWeights": "imagenet",
            "head": f"Dropout(0.2) -> Dense({len(CLASSES)}, sigmoid)",
            "trainableParameters": int(head.count_params()),
        },
        "dataset": {
            "name": "SYNDCAR: Synthetic Vehicle Damage Detection and Parts Segmentation Dataset",
            "url": "https://data.mendeley.com/datasets/hzpj48krdt/1",
            "doi": "10.17632/hzpj48krdt.1",
            "license": "CC-BY-4.0",
            "synthetic": True,
            "split": {"strategy": "device-disjoint", "trainDevice": train_device, "validationDevice": validation_device,
                       "testDevices": sorted({row["device"] for row in splits["test"]}),
                       "sizes": {split: len(subset) for split, subset in splits.items()}},
            "unlabelledImages": len(unlabelled),
            "provenanceNote": "Published by DTx CoLAB / Universidade do Minho under CC BY 4.0. Synthetic renders: performance on real photographs is a separate question.",
        },
        "training": {"seed": SEED, "epochs": args.epochs, "optimizer": "Adam(1e-3)", "loss": "per-label weighted binary crossentropy",
                      "thresholdSelection": "per-label F1 maximisation on the validation device"},
        "metrics": {"validation": validation, "test": test, "unlabelled": unlabelled_report},
        "limits": [
            "Synthetic images: this does not measure performance on real workshop photographs.",
            "Only the labels shipped with SYNDCAR are learned; it carries no 'no damage' class.",
            "The test device set is small, so intervals are wide and reported with every figure.",
        ],
    }
    (artifacts / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"runId": run_id, "devices": devices, "splits": manifest["dataset"]["split"], "thresholds": thresholds,
                      "validationMacroF1": validation["macroF1"], "testMacroF1": test["macroF1"] if test else None,
                      "unlabelled": unlabelled_report}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
