"""Container healthcheck: ready means MongoDB reachable *and* the model artefact loaded."""
from __future__ import annotations

import json
import sys
import urllib.request

try:
    with urllib.request.urlopen("http://127.0.0.1:8000/health/ready", timeout=5) as response:
        payload = json.load(response)
except Exception:  # noqa: BLE001 - any transport/parse failure is not ready
    sys.exit(1)
sys.exit(0 if payload.get("status") == "UP" else 1)
