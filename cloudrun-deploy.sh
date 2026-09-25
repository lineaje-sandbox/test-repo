#!/usr/bin/env bash
# Deploys the order-processing API to Cloud Run.
#
# The agents are NOT deployed by this script. They live on Vertex AI Agent Engine
# and are deployed separately:
#
#   backend/.venv/bin/python deploy_agents.py     # agents -> Agent Engine
#   bash cloudrun-deploy.sh                       # API + UI -> Cloud Run
#
# Run from the mars-snack directory, because the image needs agent_pkg, the
# backend and the frontend, all of which sit beside each other.

set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-fieldops-agentic-poc}"
REGION="${SERVICE_REGION:-europe-west1}"
SERVICE_NAME="${SERVICE_NAME:-mars-snack-orders}"
DOCUMENT_BUCKET="${DOCUMENT_BUCKET:-fieldops-agentic-poc-eu-marssnack-staging}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

echo "============================================================"
echo "Royal Canin CNE — Autonomous Order Processing"
echo "============================================================"
echo "  project : $PROJECT_ID"
echo "  region  : $REGION"
echo "  service : $SERVICE_NAME"
echo "  bucket  : $DOCUMENT_BUCKET"
echo ""

if [ ! -f .remote_agents.json ]; then
  echo "ERROR: .remote_agents.json not found."
  echo "The backend needs to know which Agent Engine deployments to call."
  echo "Deploy the agents first:"
  echo "  GOOGLE_CLOUD_PROJECT=$PROJECT_ID backend/.venv/bin/python deploy_agents.py"
  exit 1
fi

echo "Deployed agents this image will call:"
python3 - <<'PY'
import json
from pathlib import Path

data = json.loads(Path(".remote_agents.json").read_text(encoding="utf-8"))
for key, value in data.items():
    if not key.startswith("_"):
        print(f"  {key:12} -> {value.split('/')[-1]}")
print(f"  location     -> {data.get('_engine_location', 'unknown')}")
PY
echo ""

if [ ! -d frontend/dist ] && [ ! -d frontend/src ]; then
  echo "ERROR: no frontend found at ./frontend."
  exit 1
fi

# Enabling services can be denied by org policy without blocking a deploy that
# only needs already-enabled APIs, so this must not be fatal.
for api in run.googleapis.com cloudbuild.googleapis.com aiplatform.googleapis.com storage.googleapis.com; do
  gcloud services enable "$api" --project "$PROJECT_ID" 2>/dev/null \
    || echo "  (could not enable $api; continuing, it is probably already on)"
done

echo ""
# max-instances is deliberately 1. The order store and the SSE subscriber lists
# live in the API process, so an upload handled by one instance and the matching
# /stream request routed to another would find no order and never stream. Making
# this multi-instance means moving both into shared storage first.
echo "Building and deploying (single instance: in-process order store)..."
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 600 \
  --min-instances 0 \
  --concurrency 40 \
  --max-instances 1 \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=$PROJECT_ID,SERVICE_REGION=$REGION,DOCUMENT_BUCKET=$DOCUMENT_BUCKET,GOOGLE_GENAI_USE_VERTEXAI=TRUE"

SERVICE_URL="$(gcloud run services describe "$SERVICE_NAME" \
  --project "$PROJECT_ID" --region "$REGION" --format 'value(status.url)')"

echo ""
echo "============================================================"
echo "Deployed: $SERVICE_URL"
echo "============================================================"
echo "  health : $SERVICE_URL/api/health"
echo "  config : $SERVICE_URL/api/config"
echo "  UI     : $SERVICE_URL/"
echo ""

SERVICE_ACCOUNT="$(gcloud run services describe "$SERVICE_NAME" \
  --project "$PROJECT_ID" --region "$REGION" \
  --format 'value(spec.template.spec.serviceAccountName)')"
if [ -z "$SERVICE_ACCOUNT" ]; then
  SERVICE_ACCOUNT="$(gcloud projects describe "$PROJECT_ID" \
    --format 'value(projectNumber)')-compute@developer.gserviceaccount.com"
fi
echo "The service runs as: $SERVICE_ACCOUNT"
echo "It needs roles/aiplatform.user (to call the engines) and"
echo "roles/storage.objectAdmin on $DOCUMENT_BUCKET (to stage documents)."
echo ""
echo "Verifying health..."
if curl -fsS --max-time 90 "$SERVICE_URL/api/health" >/dev/null 2>&1; then
  curl -sS --max-time 30 "$SERVICE_URL/api/health"
  echo ""
else
  echo "Health check did not pass yet. Check the logs:"
  echo "  gcloud run services logs read $SERVICE_NAME --project $PROJECT_ID --region $REGION --limit 50"
fi
