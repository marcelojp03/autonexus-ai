"""Domain errors published by the Inteligencia service.

The HTTP surface only ever exposes `{statusCode, code, message}` with a message taken from this
closed table, mirroring the other owners (Empleados, Operaciones, BFF). Nothing from an upstream
body, a stack trace or a filesystem path is forwarded.
"""
from __future__ import annotations

MESSAGES: dict[str, str] = {
    "UNAUTHENTICATED": "Authentication is required",
    "FORBIDDEN": "The actor is not allowed to perform this action",
    "VALIDATION_ERROR": "The request body is not valid",
    "MODEL_NOT_READY": "The visual model artefact is not available",
    "IMAGE_INVALID": "The image cannot be processed",
    "IMAGE_TOO_LARGE": "The image exceeds the accepted size",
    "EVIDENCE_NOT_AVAILABLE": "The evidence is not available for analysis",
    "ASSIGNMENT_NOT_FOUND": "The work assignment is not available for this actor",
    "ANALYSIS_NOT_FOUND": "The analysis does not exist",
    "SERVICE_UNAVAILABLE": "A required service is unavailable",
    "PERSISTENCE_UNAVAILABLE": "The analysis store is unavailable",
}

PUBLISHED_CODES = tuple(MESSAGES)


class InteligenciaError(Exception):
    def __init__(self, code: str, status_code: int, *, cause: BaseException | None = None) -> None:
        if code not in MESSAGES:
            raise ValueError(f"unpublished error code: {code}")
        super().__init__(code)
        self.code = code
        self.status_code = status_code
        self.cause = cause

    def body(self) -> dict[str, object]:
        return {"statusCode": self.status_code, "code": self.code, "message": MESSAGES[self.code]}


def validation(message: str | None = None) -> InteligenciaError:
    error = InteligenciaError("VALIDATION_ERROR", 400)
    if message:
        error.detail = message  # type: ignore[attr-defined]
    return error
