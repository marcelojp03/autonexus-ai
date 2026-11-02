"""Export the trained artefact for reuse in web (TensorFlow.js) and mobile (LiteRT/TFLite).

The mobile export is produced and *verified* here: the same fixed images are scored by the Keras
model and by the TFLite interpreter and the maximum absolute difference must stay under the
declared tolerance. The web export needs the TensorFlow.js converter and a Node/browser runtime;
when that toolchain is not present the script says so explicitly instead of claiming equivalence.

Usage: python training/export_model.py --artifacts /work/artifacts
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import numpy as np

TOLERANCE = 1e-3
SAMPLES = 20


def load_samples(index: Path, raw: Path, size: int) -> np.ndarray:
    paths: list[Path] = []
    with (index / "test.jsonl").open(encoding="utf-8") as handle:
        for line in handle:
            paths.append(raw / json.loads(line)["image"])
            if len(paths) == SAMPLES:
                break
    from PIL import Image

    batch = []
    for path in paths:
        with Image.open(path) as image:
            rgb = image.convert("RGB").resize((size, size), Image.BILINEAR)
            batch.append(np.asarray(rgb, dtype="float32") / 127.5 - 1.0)
    return np.asarray(batch, dtype="float32")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="/work/data")
    parser.add_argument("--artifacts", default="/work/artifacts")
    parser.add_argument("--run-dir", default="", help="concrete run directory; defaults to the newest")
    args = parser.parse_args()

    import tensorflow as tf

    root = Path(args.root)
    dataset = json.loads((root / "dataset.json").read_text(encoding="utf-8"))
    raw = Path(dataset["localPath"])
    if not raw.exists():
        raw = root / "raw" / dataset["name"].replace("/", "__")

    versions = sorted(path for path in Path(args.artifacts).glob("**/manifest.json"))
    if not versions:
        raise SystemExit("no trained artefact found")
    directory = Path(args.run_dir) if args.run_dir else versions[-1].parent
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    size = int(manifest["preprocessing"]["inputSize"][0])
    labels = manifest["labels"]

    model = tf.keras.models.load_model(directory / "model.keras", compile=False)
    samples = load_samples(root / "index", raw, size)
    reference = model.predict(samples, verbose=0)

    baseline = directory / "saved_model"
    if baseline.exists():
        shutil.rmtree(baseline)
    model.export(str(baseline)) if hasattr(model, "export") else tf.saved_model.save(model, str(baseline))

    report: dict[str, object] = {"modelVersion": manifest["modelVersion"], "samples": int(samples.shape[0]), "labels": labels}

    # TFLite (LiteRT) — float32 and float16, verified against the Keras reference.
    for name, options in (("model.tflite", None), ("model-fp16.tflite", "fp16")):
        converter = tf.lite.TFLiteConverter.from_saved_model(str(baseline))
        if options == "fp16":
            converter.optimizations = [tf.lite.Optimize.DEFAULT]
            converter.target_spec.supported_types = [tf.float16]
        payload = converter.convert()
        (directory / name).write_bytes(payload)
        interpreter = tf.lite.Interpreter(model_content=payload)
        interpreter.allocate_tensors()
        detail = interpreter.get_input_details()[0]
        output = interpreter.get_output_details()[0]
        scores = []
        for image in samples:
            interpreter.set_tensor(detail["index"], image[None, ...].astype(detail["dtype"]))
            interpreter.invoke()
            scores.append(interpreter.get_tensor(output["index"])[0])
        difference = float(np.max(np.abs(np.asarray(scores) - reference)))
        entries = {
            "file": name,
            "sizeBytes": len(payload),
            "maxAbsDifference": round(difference, 6),
            "tolerance": TOLERANCE,
            "equivalent": difference <= TOLERANCE,
        }
        report[name] = entries
        print(json.dumps(entries))

    # Web export: requires the TensorFlow.js converter and a JS runtime for equivalence.
    try:
        import tensorflowjs  # noqa: F401
        from tensorflowjs.converters import converter

        target = directory / "tfjs"
        converter.convert_tf_saved_model(str(baseline), str(target))
        files = sorted(path.name for path in target.glob('*'))
        report["tfjs"] = {
            "files": files,
            "equivalence": "not-verified",
            "reason": "browser/Node TensorFlow.js runtime is not part of the training image; CU22 must verify equivalence before claiming the web model",
        }
        print(json.dumps({"tfjs": report["tfjs"]}))
    except Exception as error:  # noqa: BLE001 - absent toolchain is a declared pending step
        report["tfjs"] = {"converted": False, "reason": type(error).__name__, "note": "install tensorflowjs to produce the web artefact"}
        print(json.dumps({"tfjs": report["tfjs"]}))

    # The delivered mobile artefact is the float32 model. The fp16 variant is reported next to it
    # and is *not* silently counted as equivalent when it drifts beyond the tolerance.
    report["equivalentMobile"] = bool(report["model.tflite"]["equivalent"])
    report["deliveredMobile"] = "model.tflite"
    (directory / "export.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"equivalentMobile": report["equivalentMobile"]}))
    return 0 if report["equivalentMobile"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
