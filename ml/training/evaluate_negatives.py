"""Measure false alarms on representative negatives (the metric the training set cannot provide).

The training dataset has no damage-free photograph, so until now nothing measured how often the
model fires on a clean car. This script runs the *served* artefact over the Wikimedia Commons sample
collected by `fetch_negatives.mjs` and reports, per group and per label, the share of images flagged:

  * `cars`        -> a flag is a false alarm;
  * `outOfDomain` -> a flag means the model reacts to something that is not a vehicle at all.

It is a small sample (tens of images), not a benchmark: the numbers are reported as observed, with
the sample size attached, and they do not turn the model into a validated detector.

Usage: python training/evaluate_negatives.py --artifacts /work/artifacts
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="/work/data")
    parser.add_argument("--artifacts", default="/work/artifacts")
    parser.add_argument("--run-dir", default="")
    args = parser.parse_args()

    root = Path(args.root)
    versions = sorted(Path(args.artifacts).glob("**/manifest.json"))
    directory = Path(args.run_dir) if args.run_dir else versions[-1].parent
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    # Only the slice held out from training is evaluated; the fitted negatives would flatter the result.
    entries = [json.loads(line) for line in (root / "index" / "negatives-test.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]

    import tensorflow as tf
    from PIL import Image

    model = tf.keras.models.load_model(directory / "model.keras", compile=False)
    size = int(manifest["preprocessing"]["inputSize"][0])
    labels = manifest["labels"]
    thresholds = manifest["thresholds"]

    report = {"modelVersion": manifest["modelVersion"], "runId": manifest.get("runId"), "thresholds": thresholds, "groups": {}}
    groups = {}
    for entry in entries:
        groups.setdefault(entry.get("group", "unknown"), []).append(entry)
    for group, files in groups.items():
        batch = []
        for entry in files:
            with Image.open(root / entry["image"]) as image:
                rgb = image.convert("RGB").resize((size, size), Image.BILINEAR)
                batch.append(np.asarray(rgb, dtype="float32"))
        # The service preprocesses with TensorFlow ops; this reuses the same arithmetic on the
        # already-resized array so the comparison stays about the model, not about the decoder.
        values = tf.keras.applications.mobilenet_v2.preprocess_input(tf.constant(np.asarray(batch)))
        scores = model.predict(values, verbose=0)
        flagged = {name: int((scores[:, index] >= thresholds[name]).sum()) for index, name in enumerate(labels)}
        any_flag = int((np.stack([scores[:, i] >= thresholds[name] for i, name in enumerate(labels)], axis=1).max(axis=1)).sum())
        report["groups"][group] = {
            "images": len(files),
            "flaggedImages": any_flag,
            "falseAlarmRate": round(any_flag / len(files), 4),
            "flaggedPerLabel": flagged,
            "licenses": sorted({entry.get("license", "commons") for entry in files}),
            "maxScore": {name: round(float(scores[:, index].max()), 4) for index, name in enumerate(labels)},
        }
        print(json.dumps({"group": group, **report["groups"][group]}))

    report["note"] = (
        "Small licensed sample from Wikimedia Commons (licence recorded per image). Cars are assumed "
        "undamaged because the category is 'parked automobiles'; no human labelled these images "
        "exhaustively, so a flag is treated as a false alarm for reporting purposes only."
    )
    (directory / "negatives.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
