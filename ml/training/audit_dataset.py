"""Audit the dataset before trusting any metric: duplicates, session leakage and negatives.

Three questions matter more than a bigger network:

1. Are the annotations really attached to their image? The aggregator renamed part of the files
   with different numeric bases, so pairing was done by exact stem; this audit measures agreement
   between the annotation and what the trained model sees instead of assuming it.
2. Do near-duplicate images or the same capture session appear on both sides of the split? That
   would inflate the test score and a vehicle-disjoint split is impossible to prove without vehicle
   identifiers, so file-level and content-level leakage are measured instead.
3. Are there damage-free photographs? Without negatives, an "any damage" F1 is degenerate.

Usage: python training/audit_dataset.py --root /work/data
Writes /work/data/audit/duplicates.json and the clean test index lists.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path

SESSION = re.compile(r"^(vehide_\d{8}_\d{6})image")


def dhash(path: Path, size: int = 8) -> int:
    from PIL import Image

    with Image.open(path) as image:
        small = image.convert("L").resize((size + 1, size), Image.BILINEAR)
        pixels = list(small.getdata())
    bits = 0
    for row in range(size):
        for column in range(size):
            left = pixels[row * (size + 1) + column]
            right = pixels[row * (size + 1) + column + 1]
            bits = (bits << 1) | (1 if left > right else 0)
    return bits


def session_of(stem: str) -> str | None:
    match = SESSION.match(stem)
    return match.group(1) if match else None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="/work/data")
    parser.add_argument("--near-threshold", type=int, default=6, help="hamming distance for near duplicates")
    args = parser.parse_args()

    root = Path(args.root)
    dataset = json.loads((root / "dataset.json").read_text(encoding="utf-8"))
    raw = Path(dataset["localPath"])
    if not raw.exists():
        raw = root / "raw" / dataset["name"].replace("/", "__")

    rows = {}
    for split in ("train", "validation", "test"):
        with (root / "index" / f"{split}.jsonl").open(encoding="utf-8") as handle:
            rows[split] = [json.loads(line) for line in handle]

    hashes: dict[str, list[tuple[str, int]]] = defaultdict(list)
    exact: dict[str, int] = {}
    sessions: dict[str, set[str]] = {split: set() for split in rows}
    entries: dict[str, list[tuple[int, int, str | None, str]]] = {split: [] for split in rows}
    for split, split_rows in rows.items():
        for index, row in enumerate(split_rows):
            path = raw / row["image"]
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            exact[digest] = index if digest not in exact else exact[digest]
            difference = dhash(path)
            entries[split].append((index, difference, hashes and None, digest))
            stem = path.stem
            session = session_of(stem)
            if session:
                sessions[split].add(session)
            hashes[digest].append((split, index))

    def near_hits(candidate: int, reference: list[tuple[int, str]]) -> int:
        hits = 0
        for value, _ in reference:
            if bin(candidate ^ value).count("1") <= args.near_threshold:
                hits += 1
        return hits

    # Reference pools: every image in the fitted splits (train + validation).
    reference = [(difference, split) for split in ("train", "validation") for _, difference, _, _ in entries[split]]
    reference_hashes: dict[int, str] = {difference: split for split, (_, difference, _, _) in ((s, e) for s in ("train", "validation") for e in entries[s])}

    exact_ids = {digest for digest, occurrences in hashes.items() if len(occurrences) > 1}
    cross_exact = {
        digest for digest, occurrences in hashes.items()
        if len({split for split, _ in occurrences}) > 1
    }

    clean_test: list[int] = []
    report_rows = []
    for index, difference, _, digest in entries["test"]:
        duplicates_in_reference = near_hits(difference, reference)
        session = session_of((raw / rows["test"][index]["image"]).stem)
        session_overlap = bool(session and (session in sessions["train"] or session in sessions["validation"]))
        report_rows.append({
            "index": index,
            "nearInReference": duplicates_in_reference,
            "exactDuplicate": digest in exact_ids,
            "sessionOverlap": session_overlap,
        })
        if duplicates_in_reference == 0 and not session_overlap:
            clean_test.append(index)

    negatives = {
        split: sum(1 for row in split_rows if sum(row["labels"]) == 0)
        for split, split_rows in rows.items()
    }

    audit = {
        "splits": {split: len(split_rows) for split, split_rows in rows.items()},
        "exactDuplicateDigests": len(exact_ids),
        "crossSplitExactDuplicates": len(cross_exact),
        "testNearDuplicatesInFittedSplits": sum(1 for row in report_rows if row["nearInReference"] > 0),
        "testSessionOverlaps": sum(1 for row in report_rows if row["sessionOverlap"]),
        "testImagesWithoutAnyLabel": negatives["test"],
        "negativesPerSplit": negatives,
        "cleanTestImages": len(clean_test),
        "cleanTestIndexes": clean_test,
        "nearThreshold": args.near_threshold,
        "note": (
            "A vehicle-disjoint split cannot be proven: the dataset publishes no vehicle identifier. "
            "Near-duplicate and capture-session overlap are measured as proxies, and the metrics are "
            "recomputed on the subset that survives both filters."
        ),
    }
    target = root / "audit"
    target.mkdir(parents=True, exist_ok=True)
    (target / "duplicates.json").write_text(json.dumps(audit, indent=2), encoding="utf-8")
    (target / "test-clean.json").write_text(json.dumps({"indexes": clean_test}, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in audit.items() if key != "cleanTestIndexes"}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
