# MS04 Inteligencia (CU23). Built from the repository root context.
# The model artefact is NOT baked into the image: it is mounted read-only from an
# operator-provided directory, so a clone without artefacts starts in MODEL_NOT_READY.
FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TF_CPP_MIN_LOG_LEVEL=2 \
    TF_ENABLE_ONEDNN_OPTS=0

RUN apt-get update \
    && apt-get install -y --no-install-recommends libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY services/intelligence/requirements.txt /tmp/requirements.txt
RUN python -m pip install --no-cache-dir -r /tmp/requirements.txt

COPY services/intelligence/app /app/app

WORKDIR /app
EXPOSE 8000
ENTRYPOINT ["/bin/sh", "/infra/service-entrypoint.sh"]
CMD ["uvicorn", "app.serve:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
