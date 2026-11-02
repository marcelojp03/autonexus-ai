"""Check that the trained pipeline and the *deployed* service preprocessing agree.

The first version of this check compared TensorFlow decode+resize against Pillow and measured a
score delta of up to 0.29 - far outside tolerance. Two different decoders and two different
downscale kernels were being used for the same task. The fix is to have a single source of truth:
the service preprocesses with the same TensorFlow ops the training script uses, and this script
proves it by importing both implementations and comparing the scores they produce.

Usage (the service code is mounted read-only so the real class is exercised):
  python training/check_preprocessing.py --service-app /app/app --tolerance 0.005
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np

TOLERANCE = 0.005
SAMPLES = 20


def load_training_preprocess(training_dir: Path):
    spec = importlib.util.spec_from_file_location("cu23_train", training_dir / "train.py")
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module.preprocess


def load_service_model(service_app: Path):
    sys.path.insert(0, str(service_app.parent))
    from app.vision import VisionModel  # noqa: PLC0415 - imported only when the mount exists

    return VisionModel


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="/work/data")
    parser.add_argument("--training", default="/work/training")
    parser.add_argument("--artifacts", default="/work/artifacts")
    parser.add_argument("--service-app", default="/app/app")
    parser.add_argument("--tolerance", type=float, default=TOLERANCE)
    args = parser.parse_args()

    import tensorflow as tf

    root = Path(args.root)
    dataset = json.loads((root / "dataset.json").read_text(encoding="utf-8"))
    raw = Path(dataset["localPath"])
    if not raw.exists():
        raw = root / "raw" / dataset["name"].replace("/", "__")
    versions = sorted(path for path in Path(args.artifacts).glob("*/manifest.json"))
    directory = versions[-1].parent
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    model = tf.keras.models.load_model(directory / "model.keras", compile=False)

    paths = []
    with (root / "index" / "test.jsonl").open(encoding="utf-8") as handle:
        for line in handle:
            paths.append(raw / json.loads(line)["image"])
            if len(paths) == SAMPLES:
                break

    preprocess = load_training_preprocess(Path(args.training))
    training_batch = np.asarray([preprocess(str(path)).numpy() for path in paths], dtype="float32")

    service_batch = []
    if Path(args.service_app).is_dir():
        VisionModel = load_service_model(Path(args.service_app))
        vision = VisionModel(directory)
        status = vision.load()
        if not status.ready:
            raise SystemExit("service model not ready: " + str(status.reason))
        for path in paths:
            preview = vision.preview(path.read_bytes(), "image/jpeg")
            service_batch.append(preview)
    else:
        raise SystemExit("service app not mounted; mount the service code to compare the real path")

    service_batch = np.asarray(service_batch, dtype="float32")
    training_scores = model.predict(training_batch, verbose=0)
    service_scores = model.predict(service_batch, verbose=0)
    pixel_delta = float(np.max(np.abs(training_batch - service_batch)))
    score_delta = float(np.max(np.abs(training_scores - service_scores)))
    report = {
        "modelVersion": manifest["modelVersion"],
        "samples": len(paths),
        "maxPixelDelta": round(pixel_delta, 6),
        "maxScoreDelta": round(score_delta, 6),
        "perLabelScoreDelta": {
            name: round(float(np.max(np.abs(training_scores[:, index] - service_scores[:, index]))), 6)
            for index, name in enumerate(manifest["labels"])
        },
        "tolerance": args.tolerance,
        "equivalent": score_delta <= args.tolerance,
        "note": "Compares training/train.py::preprocess with the deployed VisionModel preprocessing.",
    }
    (directory / "preprocessing.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))
    return 0 if report["equivalent"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
