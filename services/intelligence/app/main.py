"""Application factory for MS04 Inteligencia (CU23)."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .auth import AccessTokenVerifier
from .config import Settings
from .errors import InteligenciaError
from .executions import ExecutionsClient
from .permissions import PermissionsClient
from .repository import AnalysisRepository
from .routes import Services, build_router
from .vision import VisionModel

LOG = logging.getLogger("autonexus.intelligence")


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved = settings or Settings.from_environment()
    model = VisionModel(resolved.model_dir)
    repository = AnalysisRepository(resolved.mongo_url, resolved.mongo_database)
    services = Services(
        settings=resolved,
        verifier=AccessTokenVerifier(resolved.issuer, resolved.jwks_uri, resolved.audience),
        permissions=PermissionsClient(resolved.employees_api_url, ttl_seconds=resolved.permissions_ttl_seconds, timeout_seconds=resolved.http_timeout_seconds),
        executions=ExecutionsClient(resolved.operations_api_url, timeout_seconds=resolved.http_timeout_seconds),
        model=model,
        repository=repository,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        status = model.load()
        LOG.info("model ready=%s version=%s reason=%s", status.ready, status.model_version, status.reason)
        try:
            await repository.start()
            LOG.info("mongo ready")
        except InteligenciaError as error:
            # Starting without the store is allowed: readiness reports it and analyses fail closed.
            LOG.warning("mongo unavailable at startup: %s", error.code)
        yield
        await repository.close()

    app = FastAPI(title="AutoNexus AI — Inteligencia (CU23)", version="1.0.0", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.include_router(build_router(services))

    @app.exception_handler(InteligenciaError)
    async def domain_error(_: Request, error: InteligenciaError) -> JSONResponse:
        return JSONResponse(error.body(), status_code=error.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, error: RequestValidationError) -> JSONResponse:
        del error
        return JSONResponse({"statusCode": 400, "code": "VALIDATION_ERROR", "message": "The request body is not valid"}, status_code=400)

    return app
