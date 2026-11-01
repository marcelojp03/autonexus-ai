"""Runtime configuration for MS04 Inteligencia (CU23).

Every value is supplied by the trusted local bootstrap (`/run/config/service.env`); nothing is
defaulted to a permissive value. Missing identity or endpoint settings make the process fail on
startup instead of running without authorization.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


class ConfigurationError(RuntimeError):
    pass


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ConfigurationError(f"missing required setting: {name}")
    return value


def _integer(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as error:
        raise ConfigurationError(f"invalid integer setting: {name}") from error


@dataclass(frozen=True)
class Settings:
    issuer: str
    jwks_uri: str
    audience: str
    employees_api_url: str
    operations_api_url: str
    mongo_url: str
    mongo_database: str
    model_dir: Path
    permissions_ttl_seconds: int
    http_timeout_seconds: float
    max_image_bytes: int
    allowed_content_types: tuple[str, ...]

    @classmethod
    def from_environment(cls) -> "Settings":
        issuer = _required("OIDC_ISSUER_URI").rstrip("/")
        return cls(
            issuer=issuer,
            # The public issuer is outside the browser for verification, so the JWKS may live on
            # the internal service name; both are supplied by the bootstrap.
            jwks_uri=_required("OIDC_JWKS_URI"),
            audience=_required("OIDC_AUDIENCE"),
            employees_api_url=_required("EMPLOYEES_API_URL").rstrip("/"),
            operations_api_url=_required("OPERATIONS_API_URL").rstrip("/"),
            mongo_url=_required("MONGO_URL"),
            mongo_database=os.environ.get("MONGO_DB", "autonexus_intelligence").strip(),
            model_dir=Path(os.environ.get("INTELLIGENCE_MODEL_DIR", "/models")),
            permissions_ttl_seconds=_integer("INTELLIGENCE_PERMISSIONS_TTL_SECONDS", 30),
            http_timeout_seconds=float(os.environ.get("INTELLIGENCE_HTTP_TIMEOUT_SECONDS", "5")),
            max_image_bytes=_integer("INTELLIGENCE_MAX_IMAGE_BYTES", 12 * 1024 * 1024),
            allowed_content_types=("image/jpeg", "image/png"),
        )
