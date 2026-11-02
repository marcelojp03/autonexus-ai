"""Visual model loading and inference.

The artefact is operator-provided: the repository only carries the manifest, so this module is
also where `MODEL_NOT_READY` is decided. When the artefact is absent the service refuses to
answer with scores - it never substitutes a generic ImageNet classifier or a heuristic.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from .errors import InteligenciaError

MIN_SUPPORT_FOR_CLAIM = 40
MAX_PIXELS = 40_000_000
MAGIC = {b"\xff\xd8\xff": "image/jpeg", b"\x89PNG\r\n\x1a\n": "image/png"}


@dataclass(frozen=True)
class LabelScore:
    name: str
    score: float
    threshold: float
    flagged: bool

    def as_dict(self) -> dict[str, object]:
        return {"name": self.name, "score": round(self.score, 4), "threshold": self.threshold, "flagged": self.flagged}


@dataclass(frozen=True)
class Prediction:
    labels: tuple[LabelScore, ...]
    model_version: str
    run_id: str | None
    task: str
    threshold: float
    insufficient_data: bool
    image_sha256: str
    width: int
    height: int
    content_type: str

    def as_dict(self) -> dict[str, object]:
        return {
            "modelVersion": self.model_version,
            "runId": self.run_id,
            "task": self.task,
            "threshold": self.threshold,
            "insufficientData": self.insufficient_data,
            "imageSha256": self.image_sha256,
            "image": {"width": self.width, "height": self.height, "contentType": self.content_type},
            "labels": [label.as_dict() for label in self.labels],
            "flagged": [label.name for label in self.labels if label.flagged],
        }


@dataclass(frozen=True)
class ModelStatus:
    ready: bool
    model_version: str | None
    run_id: str | None
    labels: tuple[str, ...]
    reason: str | None
    insufficient_data: bool

    def as_dict(self) -> dict[str, object]:
        return {
            "ready": self.ready,
            "modelVersion": self.model_version,
            "runId": self.run_id,
            "labels": list(self.labels),
            "insufficientData": self.insufficient_data,
            "reason": self.reason,
        }


class VisionModel:
    """Lazily loads `model.keras` next to its manifest. Loading failures degrade to not-ready."""

    def __init__(self, model_dir: Path, *, entry: str = "model.keras") -> None:
        self._dir = model_dir
        self._entry = entry
        self._model = None
        self._manifest: dict | None = None
        self._labels: tuple[str, ...] = ()
        self._thresholds: dict[str, float] = {}
        self._reason: str | None = "not-loaded"

    # -- lifecycle ---------------------------------------------------------------------------
    def load(self) -> ModelStatus:
        manifest_path = self._dir / "manifest.json"
        model_path = self._dir / self._entry
        if not manifest_path.is_file():
            self._reason = "manifest-missing"
            return self.status()
        if not model_path.is_file():
            self._reason = "artifact-missing"
            return self.status()
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            labels = tuple(manifest["labels"])
            thresholds = {name: float(manifest["thresholds"][name]) for name in labels}
            if not labels or len(set(labels)) != len(labels):
                raise ValueError("labels must be a non-empty unique list")
            if any(not (0.0 < thresholds[name] < 1.0) for name in labels):
                raise ValueError("thresholds must be strictly between 0 and 1")
        except (ValueError, KeyError, TypeError) as error:
            self._reason = f"manifest-invalid:{error}"
            return self.status()

        try:
            import tensorflow as tf  # imported here so a model-less service boots instantly

            tf.get_logger().setLevel("ERROR")
            model = tf.keras.models.load_model(model_path, compile=False)
            outputs = int(model.output_shape[-1])
            if outputs != len(labels):
                raise ValueError(f"model outputs {outputs} but manifest declares {len(labels)} labels")
        except Exception as error:  # noqa: BLE001 - any load failure is a not-ready state
            self._reason = f"load-failed:{type(error).__name__}"
            return self.status()

        self._model = model
        self._manifest = manifest
        self._labels = labels
        self._thresholds = thresholds
        self._reason = None
        return self.status()

    def status(self) -> ModelStatus:
        manifest = self._manifest or {}
        metrics = manifest.get("metrics", {}).get("test", {}).get("perLabel", {})
        supports = [int(metrics.get(name, {}).get("support", 0)) for name in self._labels] if metrics else []
        insufficient = bool(self._labels) and (len(supports) != len(self._labels) or any(value < MIN_SUPPORT_FOR_CLAIM for value in supports))
        return ModelStatus(
            ready=self._model is not None,
            model_version=manifest.get("modelVersion"),
            run_id=manifest.get("runId"),
            labels=self._labels,
            reason=self._reason,
            insufficient_data=insufficient,
        )

    def manifest(self) -> dict:
        if self._manifest is None:
            raise InteligenciaError("MODEL_NOT_READY", 503)
        return self._manifest

    # -- inference ---------------------------------------------------------------------------
    def analyze(self, payload: bytes, declared_content_type: str | None = None) -> Prediction:
        if self._model is None:
            raise InteligenciaError("MODEL_NOT_READY", 503)
        content_type, width, height, array = self._prepare(payload, declared_content_type)
        scores = self._model.predict(array, verbose=0)[0]
        labels = tuple(
            LabelScore(
                name=name,
                score=float(scores[index]),
                threshold=self._thresholds[name],
                flagged=bool(float(scores[index]) >= self._thresholds[name]),
            )
            for index, name in enumerate(self._labels)
        )
        status = self.status()
        return Prediction(
            labels=labels,
            model_version=str(self._manifest["modelVersion"]),
            run_id=self._manifest.get("runId"),
            task=str(self._manifest.get("task", "automotive-surface-damage-multilabel")),
            threshold=min(self._thresholds.values()),
            insufficient_data=status.insufficient_data,
            image_sha256=hashlib.sha256(payload).hexdigest(),
            width=width,
            height=height,
            content_type=content_type,
        )

    def preview(self, payload: bytes, declared_content_type: str | None = None) -> "object":
        """Preprocessed tensor for the equivalence check (same code path as `analyze`)."""
        return self._prepare(payload, declared_content_type)[3][0]

    def _prepare(self, payload: bytes, declared_content_type: str | None) -> tuple[str, int, int, "object"]:
        """Decode, resize and scale with the *same* TensorFlow ops used for training.

        The first implementation used Pillow here and TensorFlow in training; the measured score
        delta was 0.29, so the two pipelines were not interchangeable. Keeping one implementation
        removes the whole class of drift and is verified by ml/training/check_preprocessing.py.
        """
        if not payload:
            raise InteligenciaError("IMAGE_INVALID", 400)
        content_type = next((value for magic, value in MAGIC.items() if payload.startswith(magic)), None)
        if content_type is None:
            raise InteligenciaError("IMAGE_INVALID", 400)
        if declared_content_type and declared_content_type.split(";")[0].strip().lower() not in (content_type, "application/octet-stream"):
            raise InteligenciaError("IMAGE_INVALID", 400)

        import numpy as np
        import tensorflow as tf

        size = int(self._manifest["preprocessing"]["inputSize"][0])  # type: ignore[index]
        try:
            decoded = tf.io.decode_image(payload, channels=3, expand_animations=False)
            height = int(decoded.shape[0])
            width = int(decoded.shape[1])
            if width < 32 or height < 32 or width * height > MAX_PIXELS:
                raise InteligenciaError("IMAGE_INVALID", 400)
            resized = tf.image.resize(decoded, (size, size), method="bilinear", antialias=True)
            values = tf.keras.applications.mobilenet_v2.preprocess_input(tf.cast(resized, tf.float32))
            normalized = values.numpy()
        except InteligenciaError:
            raise
        except Exception as error:  # noqa: BLE001 - any decode failure is an invalid image
            raise InteligenciaError("IMAGE_INVALID", 400, cause=error) from error
        return content_type, width, height, np.expand_dims(normalized, axis=0)
