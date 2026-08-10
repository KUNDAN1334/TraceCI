# Render (or any container host). Build context is `backend/`.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies first so the layer caches across code changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY traceme ./traceme
COPY scripts ./scripts

# Free-tier disks are ephemeral: this SQLite file resets on every redeploy, so
# share links do not survive a deploy. That is an accepted trade for a portfolio
# demo; the production path is Postgres (Neon) via PostgresSaver. See README.
ENV TRACEME_DB=/app/traceme_checkpoints.sqlite

# Render injects $PORT and it is not known at build time, so this must be a
# shell-form CMD -- exec form would pass the literal string "$PORT".
EXPOSE 8000
CMD uvicorn traceme.api:app --host 0.0.0.0 --port ${PORT:-8000}
