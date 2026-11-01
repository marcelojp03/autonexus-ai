"""Per-record authorization and evidence retrieval against the owner services.

MS04 never accepts a caller-supplied URL or a caller-supplied image: the evidence is read from
Operaciones with the *actor's own* token, which revalidates scope and ownership on every call.
The bytes come from the presigned download URL that Operations issues for that actor, so the
private bucket stays private and no credential lives in this service.
"""
from __future__ import annotations

from dataclasses import dataclass

import httpx

from .auth import Identity
from .errors import InteligenciaError

READ_SELF = "executions:read:self"
READ_TEAM = "executions:read:team"


@dataclass(frozen=True)
class Evidence:
    evidence_id: str
    advance_id: str | None
    content_type: str
    size_bytes: int | None
    state: str
    file_name: str | None


@dataclass(frozen=True)
class ExecutionRecord:
    order_id: str
    assignment_id: str
    scope: str
    evidence: Evidence


class ExecutionsClient:
    def __init__(
        self,
        operations_url: str,
        *,
        timeout_seconds: float = 5,
        transport: httpx.AsyncBaseTransport | None = None,
        download_transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = operations_url
        self._timeout = timeout_seconds
        self._transport = transport
        self._download_transport = download_transport

    @staticmethod
    def scope_for(permissions: frozenset[str]) -> str:
        # Team scope is the broader grant: an actor holding both must not be limited to their own
        # assignments, or jefatura would lose access to the work it has to review.
        if READ_TEAM in permissions:
            return "team"
        if READ_SELF in permissions:
            return "me"
        raise InteligenciaError("FORBIDDEN", 403)

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=self._timeout, transport=self._transport)

    async def execution(self, identity: Identity, assignment_id: str, scope: str) -> dict:
        async with self._client() as client:
            try:
                response = await client.get(
                    f"{self._base_url}/executions/{scope}/{assignment_id}",
                    headers={"Authorization": f"Bearer {identity.token}", "Accept": "application/json"},
                )
            except httpx.HTTPError as error:
                raise InteligenciaError("SERVICE_UNAVAILABLE", 503, cause=error) from error
        if response.status_code == 404:
            raise InteligenciaError("ASSIGNMENT_NOT_FOUND", 404)
        if response.status_code in (401, 403):
            raise InteligenciaError("FORBIDDEN", 403)
        if response.status_code != 200:
            raise InteligenciaError("SERVICE_UNAVAILABLE", 503)
        try:
            body = response.json()
        except ValueError as error:
            raise InteligenciaError("SERVICE_UNAVAILABLE", 503, cause=error) from error
        if not isinstance(body, dict) or not isinstance(body.get("orderId"), str):
            raise InteligenciaError("SERVICE_UNAVAILABLE", 503)
        return body

    async def record(self, identity: Identity, assignment_id: str, evidence_id: str, permissions: frozenset[str]) -> ExecutionRecord:
        scope = self.scope_for(permissions)
        body = await self.execution(identity, assignment_id, scope)
        evidence = self._find_evidence(body, evidence_id)
        if evidence.state != "available":
            raise InteligenciaError("EVIDENCE_NOT_AVAILABLE", 409)
        return ExecutionRecord(
            order_id=str(body["orderId"]),
            assignment_id=str(body.get("assignmentId", assignment_id)),
            scope=scope,
            evidence=evidence,
        )

    @staticmethod
    def _find_evidence(body: dict, evidence_id: str) -> Evidence:
        advances = body.get("advances")
        if not isinstance(advances, list):
            raise InteligenciaError("EVIDENCE_NOT_AVAILABLE", 404)
        for advance in advances:
            if not isinstance(advance, dict):
                continue
            for item in advance.get("evidences") or []:
                if isinstance(item, dict) and str(item.get("id")) == evidence_id:
                    return Evidence(
                        evidence_id=evidence_id,
                        advance_id=str(advance.get("id")) if advance.get("id") else None,
                        content_type=str(item.get("contentType") or ""),
                        size_bytes=int(item["sizeBytes"]) if isinstance(item.get("sizeBytes"), int) else None,
                        state=str(item.get("state") or ""),
                        file_name=str(item["fileName"]) if item.get("fileName") else None,
                    )
        raise InteligenciaError("EVIDENCE_NOT_AVAILABLE", 404)

    async def download_bytes(self, identity: Identity, scope: str, assignment_id: str, evidence_id: str, *, max_bytes: int) -> bytes:
        async with self._client() as client:
            try:
                response = await client.get(
                    f"{self._base_url}/executions/{scope}/{assignment_id}/evidences/{evidence_id}/download",
                    headers={"Authorization": f"Bearer {identity.token}", "Accept": "application/json"},
                )
            except httpx.HTTPError as error:
                raise InteligenciaError("SERVICE_UNAVAILABLE", 503, cause=error) from error
        if response.status_code in (401, 403):
            raise InteligenciaError("FORBIDDEN", 403)
        if response.status_code == 404:
            raise InteligenciaError("EVIDENCE_NOT_AVAILABLE", 404)
        if response.status_code != 200:
            raise InteligenciaError("SERVICE_UNAVAILABLE", 503)
        try:
            url = str(response.json()["url"])
        except (ValueError, KeyError, TypeError) as error:
            raise InteligenciaError("SERVICE_UNAVAILABLE", 503, cause=error) from error
        if not url.startswith(("http://", "https://")):
            raise InteligenciaError("SERVICE_UNAVAILABLE", 503)

        # The URL is the one Operations signed for this actor a moment ago: no caller input and no
        # redirect following. The object is read once and kept in memory only.
        async with httpx.AsyncClient(timeout=self._timeout, transport=self._download_transport, follow_redirects=False) as client:
            try:
                async with client.stream("GET", url) as download:
                    if download.status_code != 200:
                        raise InteligenciaError("EVIDENCE_NOT_AVAILABLE", 404)
                    payload = bytearray()
                    async for chunk in download.aiter_bytes():
                        payload.extend(chunk)
                        if len(payload) > max_bytes:
                            raise InteligenciaError("IMAGE_TOO_LARGE", 413)
            except httpx.HTTPError as error:
                raise InteligenciaError("SERVICE_UNAVAILABLE", 503, cause=error) from error
        return bytes(payload)
