"""Access-token verification for MS04.

The service never trusts a caller because it reached an internal port: it validates the exact
issuer, audience and signature, and requires a bearer access token. Roles are metadata carried by
the token; the authoritative permission decision is resolved against Empleados on every request.
"""
from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass

import jwt as pyjwt
from jwt import PyJWKClient

from .errors import InteligenciaError

SLUG = re.compile(r"^[a-z][a-z0-9_:.-]{2,63}$")


@dataclass(frozen=True)
class Identity:
    subject: str
    roles: tuple[str, ...]
    token: str


class AccessTokenVerifier:
    """Validates RS256 access tokens against the realm JWKS with a bounded in-memory cache."""

    def __init__(self, issuer: str, jwks_uri: str, audience: str) -> None:
        self._issuer = issuer
        self._audience = audience
        self._jwks = PyJWKClient(jwks_uri, cache_keys=True, lifespan=300, timeout=5)

    async def verify(self, authorization: str | None) -> Identity:
        if not authorization or not authorization.lower().startswith("bearer "):
            raise InteligenciaError("UNAUTHENTICATED", 401)
        token = authorization[7:].strip()
        if not token:
            raise InteligenciaError("UNAUTHENTICATED", 401)
        claims = await asyncio.to_thread(self._decode, token)
        subject = claims.get("sub")
        if not isinstance(subject, str) or not subject:
            raise InteligenciaError("UNAUTHENTICATED", 401)
        return Identity(subject=subject, roles=self._roles(claims), token=token)

    def _decode(self, token: str) -> dict:
        try:
            signing_key = self._jwks.get_signing_key_from_jwt(token)
            claims = pyjwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256"],
                audience=self._audience,
                issuer=self._issuer,
                options={"require": ["exp", "iss", "aud", "sub"]},
            )
        except pyjwt.PyJWTError as error:
            raise InteligenciaError("UNAUTHENTICATED", 401, cause=error) from error
        except Exception as error:  # JWKS transport/parse failures must also close the door.
            raise InteligenciaError("UNAUTHENTICATED", 401, cause=error) from error
        if str(claims.get("typ", "")).lower() != "bearer":
            raise InteligenciaError("UNAUTHENTICATED", 401)
        return claims

    @staticmethod
    def _roles(claims: dict) -> tuple[str, ...]:
        realm = claims.get("realm_access")
        roles = realm.get("roles") if isinstance(realm, dict) else None
        if not isinstance(roles, list):
            return ()
        unique = {role for role in roles if isinstance(role, str) and SLUG.match(role)}
        return tuple(sorted(unique))
