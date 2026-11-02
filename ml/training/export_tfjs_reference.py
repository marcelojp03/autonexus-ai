"""Export a fixed batch and the Keras reference scores so a JS runtime can be compared with them.

TensorFlow.js runs in the browser, so the only way to know the converted artefact is equivalent is to
compare its scores against the ones the Python artefact produces for the *same* preprocessed inputs.
The inputs are stored as raw float32 so the JS side does not repeat any decoding or resizing.

Usage: python training/export_tfjs_reference.py --run-dir <artifacts>/<modelVersion>/<runId>
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

SAMPLES = 20


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="/work/data")
    parser.add_argument("--artifacts", default="/work/artifacts")
    parser.add_argument("--run-dir", default="")
    args = parser.parse_args()

    import tensorflow as tf

    root = Path(args.root)
    versions = sorted(Path(args.artifacts).glob("**/manifest.json"))
    directory = Path(args.run_dir) if args.run_dir else versions[-1].parent
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    dataset = json.loads((root / "dataset.json").read_text(encoding="utf-8"))
    raw = Path(dataset["localPath"])
    if not raw.exists():
        raw = root / "raw" / dataset["name"].replace("/", "__")

    paths = []
    with (root / "index" / "test.jsonl").open(encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            paths.append(root / row["image"] if row["image"].startswith("negatives/") else raw / row["image"])
            if len(paths) == SAMPLES:
                break

    size = int(manifest["preprocessing"]["inputSize"][0])
    batch = []
    for path in paths:
        image = tf.io.decode_image(tf.io.read_file(str(path)), channels=3, expand_animations=False)
        resized = tf.image.resize(image, (size, size), method="bilinear", antialias=True)
        batch.append(tf.keras.applications.mobilenet_v2.preprocess_input(tf.cast(resized, tf.float32)).numpy())
    batch = np.asarray(batch, dtype="float32")

    model = tf.keras.models.load_model(directory / "model.keras", compile=False)
    scores = model.predict(batch, verbose=0)

    target = directory / "tfjs-check"
    target.mkdir(parents=True, exist_ok=True)
    batch.tofile(target / "inputs.bin")
    (target / "reference.json").write_text(
        json.dumps(
            {
                "modelVersion": manifest["modelVersion"],
                "runId": manifest.get("runId"),
                "labels": manifest["labels"],
                "shape": list(batch.shape),
                "scores": np.asarray(scores, dtype="float64").round(8).tolist(),
                "inputsFile": "inputs.bin",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(json.dumps({"samples": int(batch.shape[0]), "labels": manifest["labels"], "directory": str(target)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
