"""Re-evaluate the trained model on the audit-cleaned test subset.

`audit_dataset.py` found 70 exact duplicates shared between the fitted splits and the test split,
105 near-duplicates and 315 test images that share a capture session with a fitted image, and it
found that **every** image carries at least one annotation (no damage-free photographs). The first
two facts make the headline test score optimistic; the third one makes any "any damage" metric
degenerate.

This script reports the full test split next to the subset that survives both filters, using the
thresholds selected on validation (never re-tuned on test).

Usage: python training/reeval_clean.py --artifacts /work/artifacts
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
    args = parser.parse_args()

    from sklearn.metrics import precision_recall_fscore_support, roc_auc_score

    root = Path(args.root)
    versions = sorted(path for path in Path(args.artifacts).glob("*/manifest.json"))
    directory = versions[-1].parent
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    labels = manifest["labels"]
    thresholds = manifest["thresholds"]
    audit = json.loads((root / "audit" / "duplicates.json").read_text(encoding="utf-8"))
    clean = json.loads((root / "audit" / "test-clean.json").read_text(encoding="utf-8"))["indexes"]

    cached = np.load(root / "features" / f"{manifest['modelVersion']}-test.npz")["features"]
    targets = []
    with (root / "index" / "test.jsonl").open(encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            targets.append([row["labels"][["crack", "dent", "glass_shatter", "lamp_broken", "scratch", "tire_flat"].index(name)] for name in labels])
    targets = np.asarray(targets, dtype=np.int8)

    import tensorflow as tf

    model = tf.keras.models.load_model(directory / "model.keras", compile=False)
    # The cache holds pooled MobileNetV2 features, so the trained Dense head is applied directly;
    # dropout is the identity at inference time, which keeps this arithmetic identical to serving.
    weights, bias = model.get_layer("damage_labels").get_weights()
    probabilities = 1.0 / (1.0 + np.exp(-(cached @ weights + bias)))

    def evaluate(selection: list[int]) -> dict:
        subset = probabilities[selection]
        truth = targets[selection]
        per_label = {}
        for index, name in enumerate(labels):
            predicted = (subset[:, index] >= thresholds[name]).astype(int)
            column = truth[:, index]
            precision, recall, f1, _ = precision_recall_fscore_support(column, predicted, average="binary", zero_division=0)
            try:
                auc = round(float(roc_auc_score(column, subset[:, index])), 4)
            except ValueError:
                auc = None
            per_label[name] = {"precision": round(float(precision), 4), "recall": round(float(recall), 4), "f1": round(float(f1), 4), "rocAuc": auc, "support": int(column.sum())}
        return {
            "samples": len(selection),
            "perLabel": per_label,
            "macroF1": round(float(np.mean([per_label[name]["f1"] for name in labels])), 4),
        }

    report = {
        "modelVersion": manifest["modelVersion"],
        "thresholds": thresholds,
        "fullTest": evaluate(list(range(len(targets)))),
        "cleanTest": evaluate(clean),
        "excludedByAudit": len(targets) - len(clean),
        "audit": {
            "crossSplitExactDuplicates": audit["crossSplitExactDuplicates"],
            "testNearDuplicatesInFittedSplits": audit["testNearDuplicatesInFittedSplits"],
            "testSessionOverlaps": audit["testSessionOverlaps"],
            "imagesWithoutAnyLabel": audit["negativesPerSplit"],
        },
        "note": (
            "Thresholds fixed on validation. The clean subset excludes test images that are exact or "
            "near duplicates of a fitted image, and images sharing a capture session with the fitted "
            "splits. The dataset has no damage-free photographs, so no false-alarm rate can be "
            "estimated from it."
        ),
    }
    (directory / "clean-evaluation.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"fullTest": report["fullTest"]["macroF1"], "cleanTest": report["cleanTest"]["macroF1"], "cleanSamples": report["cleanTest"]["samples"], "excluded": report["excludedByAudit"], "perLabel": {k: v["f1"] for k, v in report["cleanTest"]["perLabel"].items()}}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
