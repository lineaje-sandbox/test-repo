# Deploying

Two deployments, in this order. The agents must exist before the image is built,
because the image bakes in `.remote_agents.json`.

```bash
cd mars-snack

# 1. Agents -> Vertex AI Agent Engine
GOOGLE_CLOUD_PROJECT=fieldops-agentic-poc backend/.venv/bin/python deploy_agents.py

# 2. API + UI -> Cloud Run
bash cloudrun-deploy.sh
```

## Prerequisites

| Requirement | Notes |
|---|---|
| Project | `fieldops-agentic-poc` (number `321373241776`) |
| APIs | `aiplatform`, `run`, `cloudbuild`, `storage`. The deploy script tries to enable them and continues if the org policy denies it. |
| Staging bucket | `gs://fieldops-agentic-poc-eu-marssnack-staging` in `europe-west1`. Used for both Agent Engine staging and order documents. |
| Auth | `gcloud auth application-default login` |
| Python | `backend/.venv` with `google-cloud-aiplatform[adk,agent_engines]` for deploying. The **runtime** image does not include the aiplatform SDK; it calls the engines over REST. |

Behind the corporate proxy, `gcloud` needs an explicit token and local `curl`
needs to bypass the proxy:

```bash
export CLOUDSDK_AUTH_ACCESS_TOKEN="$(gcloud auth application-default print-access-token)"
curl --noproxy '*' http://127.0.0.1:8080/api/health
```

## IAM

The Cloud Run service account needs two roles. `cloudrun-deploy.sh` prints the
account it is running as at the end of a deploy.

```bash
SA="321373241776-compute@developer.gserviceaccount.com"

# Call the Agent Engine deployments
gcloud projects add-iam-policy-binding fieldops-agentic-poc \
  --member "serviceAccount:$SA" --role roles/aiplatform.user

# Stage order documents the agents read by gs:// reference
gcloud storage buckets add-iam-policy-binding \
  gs://fieldops-agentic-poc-eu-marssnack-staging \
  --member "serviceAccount:$SA" --role roles/storage.objectAdmin
```

## Cloud Run configuration, and why

| Setting | Value | Reason |
|---|---|---|
| `--max-instances` | **1** | The order store and the SSE subscriber lists live in the API process. An upload handled by one instance and the matching `/stream` request routed to another would find no order and never stream. Going multi-instance means moving both into shared storage first. |
| `--concurrency` | 40 | Plenty for a demo with one instance. |
| `--timeout` | 600 | SSE connections are long-lived. |
| `--memory` / `--cpu` | 2Gi / 2 | The image holds the SPA and `agent_pkg`; PDF handling is memory-hungry in bursts. |
| `--allow-unauthenticated` | yes | It is a demo that has to open in a browser. The URL is public: **do not put real customer documents in it.** |
| `--min-instances` | 0 | Costs nothing idle; first request pays a cold start of a few seconds. |

Order state is written to the container filesystem, so it is **lost on restart**
and not shared between revisions. That is intentional for a demo. On startup, any
order found in a non-terminal state is marked `FAILED` with an explanation,
because a run whose process died can never be resumed and would otherwise show a
row that streams forever with an ever-growing elapsed time.

## Gotchas that cost real time

All four were established by deploying and watching it fail.

1. **`GOOGLE_CLOUD_PROJECT` cannot be passed in `env_vars`.** The Agent Engine
   runtime reserves the name and rejects the create call outright. The runtime
   sets it for you.
2. **`extra_packages` must be a relative path to a package *directory*.** An
   absolute path, or a bare `.py` file, is accepted at create time; the engine then
   fails to boot with `No module named ...`. The failure surfaces minutes later, in
   the engine's logs, not in the deploy output.
3. **`GOOGLE_CLOUD_LOCATION=global` on the engine** is what puts inference on the
   only endpoint serving Gemini 3.x for this project, while the engine itself still
   runs in `europe-west1`. Verified: a `europe-west1` engine reporting
   `model_version: gemini-3.8-flash`.
4. **gRPC does not survive the corporate proxy.** The SDK is initialised with
   `api_transport="rest"`.

Two more, from the API side:

5. **The engine streams NDJSON, but the SDK's stream parser expects a JSON
   array.** `backend/remote.py` therefore calls `streamQuery?alt=sse` over plain
   `requests` with its own line accumulator. This is the same approach `gwpa` took,
   for the same reason.
6. **`Dockerfile` must stay at the root of the build context.** `gcloud run deploy
   --source .` only uses a Dockerfile named `Dockerfile` at the context root.
   Anywhere else it silently falls back to buildpacks and produces an image with no
   frontend and no `agent_pkg`. The build log line to look for is `Building using
   Dockerfile`.

Also worth knowing: `ADK` module-level names matter. Each agent module exports
`root_agent` and `agent_pkg/__init__.py` exports **only modules**. An earlier
version re-exported the agent objects under the same names as their modules, which
shadowed them and produced `'LlmAgent' object has no attribute 'profile'` at
runtime.

## Local development

```bash
# Backend (needs the repo root on PYTHONPATH so agent_pkg resolves)
cd backend
ln -sfn ../frontend/dist frontend_dist     # so / serves the built SPA
GOOGLE_CLOUD_PROJECT=fieldops-agentic-poc \
SERVICE_REGION=europe-west1 \
REQUESTS_CA_BUNDLE=../../combined_certs.pem \
SSL_CERT_FILE=../../combined_certs.pem \
PYTHONPATH=.. .venv/bin/uvicorn app:app --host 127.0.0.1 --port 8080

# Frontend, against that backend
cd frontend && npm run dev

# Frontend with no backend at all
VITE_USE_MOCK=1 npm run dev
```

The agents always run remotely: there is no local agent mode. Local calls to
Vertex need `REQUESTS_CA_BUNDLE`/`SSL_CERT_FILE` pointed at `combined_certs.pem`
for the proxy. The deployed service needs neither, because it is already inside
Google's network.

## Verifying a deployment

```bash
URL="$(gcloud run services describe mars-snack-orders \
  --project fieldops-agentic-poc --region europe-west1 --format 'value(status.url)')"

curl -sS "$URL/api/health"
curl -sS "$URL/api/config"      # should report both engine ids and both models
```

Then in the browser: upload the Kalisz sample and watch the rail reach
`Outcome: READY`; upload the unmapped-item sample, correct the store number in the
exception queue, and confirm the order flips to `READY` with your name on the
resolution.

For the full assertion suite against the deployed engines:

```bash
cd backend
GOOGLE_CLOUD_PROJECT=fieldops-agentic-poc PYTHONPATH=.. .venv/bin/python verify.py
```

## Managing the agents

```bash
# What is deployed
GOOGLE_CLOUD_PROJECT=fieldops-agentic-poc backend/.venv/bin/python deploy_agents.py --list

# Redeploy after changing agent_pkg (rewrites .remote_agents.json)
GOOGLE_CLOUD_PROJECT=fieldops-agentic-poc backend/.venv/bin/python deploy_agents.py
```

Redeploying the agents changes the engine ids, so **rebuild the Cloud Run image
afterwards** — the ids are baked into it via `.remote_agents.json`.

Note that `gcloud ai` has no `reasoning-engines` subcommand. Listing or deleting
engines goes through the Python SDK (`vertexai.agent_engines`). The project hosts
engines belonging to other work (`GWPA_*`, `WD_*`, `triage-*`); only the two
`MARSSNACK_*` engines belong to this app.
