# Cloud Run image for the order-processing API.
#
# This image contains the FastAPI backend, the built frontend, and `agent_pkg`.
# The agents themselves are NOT run here: they are deployed separately to Vertex
# AI Agent Engine by `deploy_agents.py`. `agent_pkg` is present because the
# backend's authority pass re-runs the same deterministic tools the deployed
# agents use, and both sides must use the same code and the same master data.
#
# This file lives at the root of the build context on purpose. `gcloud run deploy
# --source .` only uses a Dockerfile when it finds one named `Dockerfile` at the
# context root; anywhere else it silently falls back to buildpacks, which would
# produce an image with no frontend and no agent_pkg.
#
#   docker build -t mars-snack .            # from the mars-snack directory

FROM node:20-slim AS frontend

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --fund=false
COPY frontend/ ./
RUN npm run build


FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    # agent_pkg and the backend modules both sit under /app.
    PYTHONPATH=/app

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# The shared agent package: tools, master data, schemas, agent definitions.
COPY agent_pkg/ ./agent_pkg/
# Which engines to call. Written by deploy_agents.py, so the agents must be
# deployed before the image is built.
COPY .remote_agents.json ./.remote_agents.json
COPY backend/*.py ./backend/
COPY samples/ ./samples/
COPY --from=frontend /build/dist ./backend/frontend_dist

# Cloud Run sets PORT; default to 8080 for local runs.
ENV PORT=8080
WORKDIR /app/backend
CMD exec uvicorn app:app --host 0.0.0.0 --port ${PORT} --timeout-keep-alive 75
