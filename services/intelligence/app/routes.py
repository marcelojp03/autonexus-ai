"""HTTP surface of MS04 Inteligencia (CU23).

Routes:
  GET  /health/live                  liveness, no dependencies
  GET  /health/ready                 MongoDB reachable *and* model artefact loaded
  GET  /vision/model                 model status and manifest summary (authenticated)
  POST /vision/analyze               analyse one authorised CU16 evidence
  GET  /vision/analyses/{id}         one stored analysis
  GET  /vision/assignments/{id}      analyses of one work assignment
  GET  /vision/orders/{id}           analyses of one work order (assignment-scoped)
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import APIRouter, Header, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from .auth import AccessTokenVerifier, Identity
from .config import Settings
from .errors import InteligenciaError
from .executions import ExecutionsClient
from .permissions import PermissionsClient
from .repository import AnalysisRepository
from .vision import VisionModel

ANALYZE = "intelligence:analyze"
READ = "intelligence:read"


@dataclass
class Services:
    settings: Settings
    verifier: AccessTokenVerifier
    permissions: PermissionsClient
    executions: ExecutionsClient
    model: VisionModel
    repository: AnalysisRepository


class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assignmentId: str = Field(min_length=1, max_length=64)
    evidenceId: str = Field(min_length=1, max_length=64)


class ClientLabel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=40)
    score: float = Field(ge=0.0, le=1.0)


class ClientAnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assignmentId: str = Field(min_length=1, max_length=64)
    evidenceId: str | None = Field(default=None, max_length=64)
    runId: str = Field(min_length=1, max_length=64)
    modelVersion: str = Field(min_length=1, max_length=80)
    imageSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    labels: list[ClientLabel] = Field(min_length=1, max_length=32)

async def _identity(services: Services, authorization: str | None) -> Identity:
    return await services.verifier.verify(authorization)


async def _grant(services: Services, identity: Identity, permission: str) -> frozenset[str]:
    permissions = await services.permissions.effective(identity)
    if permission not in permissions:
        raise InteligenciaError("FORBIDDEN", 403)
    return permissions


def build_router(services: Services) -> APIRouter:
    router = APIRouter()

    @router.get("/health/live")
    async def live() -> dict[str, str]:
        return {"status": "UP", "service": "intelligence"}

    @router.get("/health/ready")
    async def ready() -> JSONResponse:
        mongo = await services.repository.ready()
        model = services.model.status()
        healthy = mongo and model.ready
        payload = {
            "status": "UP" if healthy else "DOWN",
            "service": "intelligence",
            "mongo": "up" if mongo else "down",
            "model": model.as_dict(),
        }
        return JSONResponse(payload, status_code=200 if healthy else 503)

    @router.get("/vision/model")
    async def model_status(authorization: Annotated[str | None, Header()] = None) -> dict[str, Any]:
        await _identity(services, authorization)
        status = services.model.status()
        manifest = services.model.manifest() if status.ready else None
        return {
            "model": status.as_dict(),
            "task": manifest.get("task") if manifest else None,
            "preprocessing": manifest.get("preprocessing") if manifest else None,
            "dataset": {
                key: manifest["dataset"].get(key)
                for key in ("name", "url", "license", "revision")
            }
            if manifest
            else None,
            "limits": manifest.get("limits") if manifest else None,
        }

    @router.post("/vision/analyze")
    async def analyze(payload: AnalyzeRequest, authorization: Annotated[str | None, Header()] = None) -> dict[str, Any]:
        identity = await _identity(services, authorization)
        permissions = await _grant(services, identity, ANALYZE)
        record = await services.executions.record(identity, payload.assignmentId, payload.evidenceId, permissions)
        if not services.model.status().ready:
            raise InteligenciaError("MODEL_NOT_READY", 503)
        image = await services.executions.download_bytes(
            identity,
            record.scope,
            record.assignment_id,
            record.evidence.evidence_id,
            max_bytes=services.settings.max_image_bytes,
        )
        if record.evidence.size_bytes is not None and len(image) > record.evidence.size_bytes:
            raise InteligenciaError("IMAGE_TOO_LARGE", 413)
        prediction = await asyncio.to_thread(services.model.analyze, image, record.evidence.content_type)
        return await services.repository.save(
            prediction,
            assignment_id=record.assignment_id,
            evidence_id=record.evidence.evidence_id,
            order_id=record.order_id,
            actor_subject=identity.subject,
            actor_roles=identity.roles,
        )

    @router.post("/vision/client-analyses")
    async def client_analysis(payload: ClientAnalysisRequest, authorization: Annotated[str | None, Header()] = None) -> dict[str, Any]:
        """Records an inference that ran on the device.

        This service does not compute anything here: it stores what the client reported, keeps the
        provenance (`origin: client`, runId, modelVersion, image hash) and says explicitly that the
        server did not verify it. The record feeds the history next to the server analyses without
        ever being presented as one.
        """
        identity = await _identity(services, authorization)
        permissions = await _grant(services, identity, ANALYZE)
        await services.executions.execution(identity, payload.assignmentId, ExecutionsClient.scope_for(permissions))
        return await services.repository.save_client_analysis(
            {
                "assignmentId": payload.assignmentId,
                "evidenceId": payload.evidenceId,
                "runId": payload.runId,
                "modelVersion": payload.modelVersion,
                "imageSha256": payload.imageSha256,
                "labels": [label.model_dump() for label in payload.labels],
                "subject": identity.subject,
                "roles": identity.roles,
            }
        )
    @router.get("/vision/analyses/{analysis_id}")
    async def analysis(analysis_id: str, authorization: Annotated[str | None, Header()] = None) -> dict[str, Any]:
        identity = await _identity(services, authorization)
        permissions = await _grant(services, identity, READ)
        stored = await services.repository.by_id(analysis_id)
        # Re-resolve the record authorization instead of trusting the stored identifiers.
        await services.executions.record(identity, stored["assignmentId"], stored["evidenceId"], permissions)
        return stored

    @router.get("/vision/assignments/{assignment_id}")
    async def assignment(assignment_id: str, authorization: Annotated[str | None, Header()] = None) -> dict[str, Any]:
        identity = await _identity(services, authorization)
        permissions = await _grant(services, identity, READ)
        await services.executions.execution(identity, assignment_id, ExecutionsClient.scope_for(permissions))
        return {"assignmentId": assignment_id, "items": await services.repository.by_assignment(assignment_id)}

    @router.get("/vision/orders/{order_id}")
    async def order(
        order_id: str,
        assignment_id: Annotated[str, Query(alias="assignmentId", min_length=1, max_length=64)],
        authorization: Annotated[str | None, Header()] = None,
    ) -> dict[str, Any]:
        identity = await _identity(services, authorization)
        permissions = await _grant(services, identity, READ)
        execution = await services.executions.execution(identity, assignment_id, ExecutionsClient.scope_for(permissions))
        if str(execution.get("orderId")) != order_id:
            # Same answer as an unknown order: the order and the assignment must agree.
            raise InteligenciaError("ASSIGNMENT_NOT_FOUND", 404)
        return {"orderId": order_id, "items": await services.repository.by_order(order_id)}

    return router
