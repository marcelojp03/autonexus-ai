"""MongoDB persistence for vision analyses.

Only derived data is stored: labels, scores, the image hash and the metadata needed to answer
"which model looked at which evidence of which work order". The image itself never leaves memory.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from pymongo import ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError, PyMongoError
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from .errors import InteligenciaError
from .vision import Prediction


def _document(prediction: Prediction, *, assignment_id: str, evidence_id: str, order_id: str, actor_subject: str, actor_roles: tuple[str, ...]) -> dict[str, Any]:
    created = datetime.now(timezone.utc)
    return {
        "analysisId": str(uuid.uuid4()),
        "assignmentId": assignment_id,
        "evidenceId": evidence_id,
        "orderId": order_id,
        "modelVersion": prediction.model_version,
        "task": prediction.task,
        "labels": [label.as_dict() for label in prediction.labels],
        "flagged": [label.name for label in prediction.labels if label.flagged],
        "threshold": prediction.threshold,
        "insufficientData": prediction.insufficient_data,
        "imageSha256": prediction.image_sha256,
        "image": {"width": prediction.width, "height": prediction.height, "contentType": prediction.content_type},
        "actor": {"subject": actor_subject, "roles": list(actor_roles)},
        "createdAt": created,
    }


def _view(document: dict[str, Any], *, replayed: bool = False) -> dict[str, Any]:
    created = document["createdAt"]
    if isinstance(created, datetime):
        created = created.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "analysisId": document["analysisId"],
        "assignmentId": document["assignmentId"],
        "evidenceId": document["evidenceId"],
        "orderId": document["orderId"],
        "modelVersion": document["modelVersion"],
        "task": document["task"],
        "labels": document["labels"],
        "flagged": document["flagged"],
        "threshold": document["threshold"],
        "insufficientData": document["insufficientData"],
        "imageSha256": document["imageSha256"],
        "image": document["image"],
        "createdAt": created,
        "replayed": replayed,
    }


class AnalysisRepository:
    def __init__(self, url: str, database: str, *, client: AsyncIOMotorClient | None = None) -> None:
        self._client = client or AsyncIOMotorClient(url, serverSelectionTimeoutMS=3000, connectTimeoutMS=3000, tz_aware=True)
        self._database: AsyncIOMotorDatabase = self._client[database]
        self._collection = self._database["vision_analyses"]

    async def start(self) -> None:
        try:
            await self._client.admin.command("ping")
        except PyMongoError as error:
            raise InteligenciaError("PERSISTENCE_UNAVAILABLE", 503, cause=error) from error
        try:
            await self._collection.create_index([("analysisId", ASCENDING)], unique=True, name="analysis_id")
            await self._collection.create_index([("evidenceId", ASCENDING), ("modelVersion", ASCENDING), ("imageSha256", ASCENDING)], unique=True, name="evidence_model_image")
            await self._collection.create_index([("orderId", ASCENDING), ("createdAt", DESCENDING)], name="order_created")
            await self._collection.create_index([("assignmentId", ASCENDING), ("createdAt", DESCENDING)], name="assignment_created")
        except PyMongoError as error:
            raise InteligenciaError("PERSISTENCE_UNAVAILABLE", 503, cause=error) from error

    async def ready(self) -> bool:
        try:
            await self._client.admin.command("ping")
            return True
        except PyMongoError:
            return False

    async def close(self) -> None:
        self._client.close()

    async def save(self, prediction: Prediction, *, assignment_id: str, evidence_id: str, order_id: str, actor_subject: str, actor_roles: tuple[str, ...]) -> dict[str, Any]:
        """Persist once per (evidence, model, image hash); a replay returns the stored analysis."""
        document = _document(
            prediction,
            assignment_id=assignment_id,
            evidence_id=evidence_id,
            order_id=order_id,
            actor_subject=actor_subject,
            actor_roles=actor_roles,
        )
        try:
            await self._collection.insert_one(document)
            return _view(document)
        except DuplicateKeyError:
            existing = await self._collection.find_one(
                {"evidenceId": evidence_id, "modelVersion": prediction.model_version, "imageSha256": prediction.image_sha256}
            )
            if existing is None:
                raise InteligenciaError("PERSISTENCE_UNAVAILABLE", 503)
            return _view(existing, replayed=True)
        except PyMongoError as error:
            raise InteligenciaError("PERSISTENCE_UNAVAILABLE", 503, cause=error) from error

    async def by_id(self, analysis_id: str) -> dict[str, Any]:
        try:
            document = await self._collection.find_one({"analysisId": analysis_id})
        except PyMongoError as error:
            raise InteligenciaError("PERSISTENCE_UNAVAILABLE", 503, cause=error) from error
        if document is None:
            raise InteligenciaError("ANALYSIS_NOT_FOUND", 404)
        return _view(document)

    async def by_assignment(self, assignment_id: str) -> list[dict[str, Any]]:
        return await self._list({"assignmentId": assignment_id})

    async def by_order(self, order_id: str) -> list[dict[str, Any]]:
        return await self._list({"orderId": order_id})

    async def _list(self, query: dict[str, Any]) -> list[dict[str, Any]]:
        try:
            cursor = self._collection.find(query).sort("createdAt", DESCENDING).limit(100)
            return [_view(document) async for document in cursor]
        except PyMongoError as error:
            raise InteligenciaError("PERSISTENCE_UNAVAILABLE", 503, cause=error) from error
