"""Turn the YOLO detection annotations into image-level multi-label targets and splits.

The CU23 task is "does this photo show a visible automotive defect, and which one". Boxes are
collapsed into one binary target per class; the box geometry is intentionally discarded because
the delivered capability is a signal for human review, not a measurement.

Splits (fixed, deterministic, seed independent because they derive from a path hash):
  * train  - 85% of the dataset ``train`` split, used to fit the head
  * validation - 15% of the dataset ``train`` split, used only for thresholds/early stop
  * test   - the dataset ``val`` split, never seen during fitting or threshold selection
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

CLASSES = ["crack", "dent", "glass_shatter", "lamp_broken", "scratch", "tire_flat"]


def bucket(path: str, train_mod: int = 85) -> str:
    digest = hashlib.sha256(path.encode("utf-8")).digest()
    return "train" if digest[0] % 100 < train_mod else "validation"


def read_targets(label_file: Path) -> tuple[list[int], int]:
    if not label_file.exists():
        return [0] * len(CLASSES), 0
    targets = [0] * len(CLASSES)
    boxes = 0
    for line in label_file.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) < 5:
            continue
        index = int(parts[0])
        if 0 <= index < len(CLASSES):
            targets[index] = 1
            boxes += 1
    return targets, boxes


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="/work/data")
    args = parser.parse_args()

    root = Path(args.root)
    manifest = json.loads((root / "dataset.json").read_text(encoding="utf-8"))
    raw = Path(manifest["localPath"])
    if not raw.exists():
        raw = root / "raw" / manifest["name"].replace("/", "__")

    # Only stems that exist on both sides are used: the published dataset renames part of its
    # images with a different numeric base, so an unpaired stem would attach the wrong annotation.
    pairs = json.loads((root / "pairs.json").read_text(encoding="utf-8"))
    rows: dict[str, list[dict]] = {"train": [], "validation": [], "test": []}
    for split in ("train", "val"):
        paired = int(pairs["splits"][split]["pairs"])
        used = 0
        for image in sorted((raw / "images" / split).glob("*.jpg")):
            label = raw / "labels" / split / (image.stem + ".txt")
            if not label.exists():
                continue
            used += 1
            targets, boxes = read_targets(label)
            row = {
                "image": str(image.relative_to(raw)).replace("\\", "/"),
                "labels": targets,
                "boxes": boxes,
                "sourceSplit": split,
            }
            target_split = bucket(row["image"]) if split == "train" else "test"
            rows[target_split].append(row)
        if used != paired:
            raise SystemExit(f"paired {paired} images but {used} label files are present in {split}")

    index = root / "index"
    # Licensed negatives: the training collection has no damage-free photograph, so the head never
    # learns what "nothing wrong" looks like. These come from Wikimedia Commons with the licence
    # recorded per image; 75 % go to training, 25 % to validation and a fixed 20-image slice is held
    # out as an independent false-alarm set (never used to fit thresholds).
    negatives_manifest = root / "negatives" / "manifest.json"
    if negatives_manifest.exists():
        sample = json.loads(negatives_manifest.read_text(encoding="utf-8"))
        entries = []
        for group, payload in sample["groups"].items():
            for item in payload["files"]:
                entries.append({"image": "negatives/" + item["file"], "group": group, "license": item["license"], "page": item["page"]})
        entries.sort(key=lambda entry: entry["image"])
        held_out = [entry for position, entry in enumerate(entries) if position % 4 == 0]
        fitted_negatives = [entry for position, entry in enumerate(entries) if position % 4 != 0]
        with (index / "negatives-test.jsonl").open("w", encoding="utf-8") as handle:
            for entry in held_out:
                handle.write(json.dumps({"image": entry["image"], "labels": [0] * len(CLASSES), "boxes": 0, "sourceSplit": "commons", "group": entry["group"]}) + "\n")
        for entry in fitted_negatives:
            bucket_split = bucket(entry["image"], train_mod=75)
            rows[bucket_split].append({"image": entry["image"], "labels": [0] * len(CLASSES), "boxes": 0, "sourceSplit": "commons", "group": entry["group"]})
        print(json.dumps({"negatives": {"fitted": len(fitted_negatives), "heldOut": len(held_out)}}))
    index.mkdir(parents=True, exist_ok=True)
    stats = {"classes": CLASSES, "splits": {}, "dataset": manifest["name"], "revision": manifest["revision"]}
    for split, split_rows in rows.items():
        path = index / f"{split}.jsonl"
        with path.open("w", encoding="utf-8") as handle:
            for row in split_rows:
                handle.write(json.dumps(row) + "\n")
        positives = [sum(row["labels"][i] for row in split_rows) for i in range(len(CLASSES))]
        negatives = [len(split_rows) - count for count in positives]
        stats["splits"][split] = {
            "images": len(split_rows),
            "withBoxes": sum(1 for row in split_rows if row["boxes"] > 0),
            "positives": dict(zip(CLASSES, positives)),
            "negatives": dict(zip(CLASSES, negatives)),
        }

    (index / "stats.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")
    print(json.dumps(stats, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
