"""ASGI entrypoint (`uvicorn app.serve:app`). Kept separate from the factory for WSGI-style imports."""
from __future__ import annotations

import os

from .main import create_app

app = create_app()

if __name__ == "__main__":  # pragma: no cover - container convenience
    import uvicorn

    uvicorn.run(app, host=os.environ.get("HTTP_HOST", "0.0.0.0"), port=int(os.environ.get("PORT", "8000")))
