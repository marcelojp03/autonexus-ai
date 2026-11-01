"""Download the public automotive damage dataset used to train the CU23 visual model.

Idempotent: a second run reuses the cached snapshot when the Hub revision did not change.
The dataset is never committed to Git (``data/`` and ``datasets/`` are ignored); only the
manifest produced here, and the license/provenance captured with it, are reproducible.

Dataset: tugberkkalay/autodamageiq-vehicle-damage-dataset (CC BY 4.0), YOLO detection
annotations over CarDD + VehiDE + human-in-the-loop labeled images.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

REPO_ID = "tugberkkalay/autodamageiq-vehicle-damage-dataset"
REPO_TYPE = "dataset"
LICENSE = "CC-BY-4.0"
ALLOW_PATTERNS = ["data.yaml", "images/*", "labels/*", "README.md"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="/work/data", help="local data root")
    args = parser.parse_args()

    from huggingface_hub import HfApi, snapshot_download

    root = Path(args.root)
    target = root / "raw" / REPO_ID.replace("/", "__")
    target.mkdir(parents=True, exist_ok=True)

    info = HfApi().dataset_info(REPO_ID)
    revision = info.sha
    manifest_path = root / "dataset.json"
    if manifest_path.exists():
        previous = json.loads(manifest_path.read_text(encoding="utf-8"))
        if previous.get("revision") == revision and (target / "data.yaml").exists():
            print(json.dumps({"dataset": REPO_ID, "revision": revision, "cached": True}))
            return 0

    path = snapshot_download(
        repo_id=REPO_ID,
        repo_type=REPO_TYPE,
        local_dir=str(target),
        allow_patterns=ALLOW_PATTERNS,
        max_workers=32,
    )

    images = sorted(target.glob("images/*/*.jpg"))
    labels = sorted(target.glob("labels/*/*.txt"))
    manifest = {
        "name": REPO_ID,
        "url": f"https://huggingface.co/datasets/{REPO_ID}",
        "license": LICENSE,
        "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
        "revision": revision,
        "downloadedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "localPath": path,
        "counts": {"images": len(images), "labels": len(labels)},
        "upstreamSources": ["CarDD", "VehiDE", "human-in-the-loop GPT-4o labels"],
        "provenanceNote": (
            "Aggregated third-party dataset. The CC BY 4.0 declaration, class list and counts are "
            "taken from the dataset card; per-image vehicle identity is not published, so a "
            "vehicle-disjoint split cannot be guaranteed."
        ),
    }
    root.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({k: manifest[k] for k in ("name", "revision", "license", "counts")}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
