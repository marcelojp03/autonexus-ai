"""Effective-permission resolution.

Permissions are owned by Empleados (CU02). MS04 asks the owner on every request, caches the answer
for a short window keyed by subject and claimant roles, and fails closed: any transport, status or
shape problem yields no permissions, so no analysis is produced without an explicit grant.
"""
from __future__ import annotations

import time
from typing import Callable

import httpx

from .auth import Identity
from .errors import InteligenciaError


class PermissionsClient:
    def __init__(
        self,
        base_url: str,
        *,
        ttl_seconds: int = 30,
        timeout_seconds: float = 5,
        transport: httpx.AsyncBaseTransport | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._base_url = base_url
        self._ttl = ttl_seconds
        self._timeout = timeout_seconds
        self._transport = transport
        self._clock = clock
        self._cache: dict[tuple[str, tuple[str, ...]], tuple[float, frozenset[str]]] = {}

    async def effective(self, identity: Identity) -> frozenset[str]:
        key = (identity.subject, identity.roles)
        cached = self._cache.get(key)
        now = self._clock()
        if cached and cached[0] > now:
            return cached[1]

        permissions = await self._fetch(identity)
        self._cache[key] = (now + self._ttl, permissions)
        if len(self._cache) > 500:
            self._cache = {k: v for k, v in self._cache.items() if v[0] > now}
        return permissions

    async def _fetch(self, identity: Identity) -> frozenset[str]:
        try:
            async with httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as client:
                response = await client.get(
                    f"{self._base_url}/security/permissions",
                    headers={"Authorization": f"Bearer {identity.token}", "Accept": "application/json"},
                )
        except httpx.HTTPError as error:
            raise InteligenciaError("SERVICE_UNAVAILABLE", 503, cause=error) from error
        if response.status_code != 200:
            raise InteligenciaError("SERVICE_UNAVAILABLE", 503)
        try:
            body = response.json()
            effective = body["effective"]
            if not isinstance(effective, list) or not all(isinstance(item, str) for item in effective):
                raise ValueError("effective must be a string list")
        except (ValueError, KeyError, TypeError) as error:
            raise InteligenciaError("SERVICE_UNAVAILABLE", 503, cause=error) from error
        return frozenset(effective)
