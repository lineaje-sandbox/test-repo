# Royal Canin CNE — Autonomous Order Processing

Two Gemini agents on Google ADK read incoming purchase-order PDFs, reconcile them
against master data, and release the clean ones. Only genuine exceptions reach a
human. It replaces an Automation Anywhere + OCR chain that needs a template per
customer layout.

The demo runs on the real document: `EU Compliance Order - Royal Canin _ Mars
Pitch.pdf`.

## What it does

An order PDF arrives. Then:

1. **Ingestion & Extraction** (`gemini-3.8-flash`) reads the document and returns
   structured fields against a response schema. It has no tools: its only job is
   to read what the page says.
2. **Validation & Reconciliation** (`gemini-3.1-pro-preview`) checks the order
   against master data using six deterministic tools, and explains every problem
   it finds in the reviewer's language.
3. **The authority pass** re-runs the same tools in Python after the agent has
   finished. Python's numbers win. Where the agent and Python disagree, the
   disagreement is written into the audit trail rather than hidden.
4. Clean orders become `READY` and can be released. Anything else raises a typed
   exception naming the field, what was observed, and what was expected.

The division of labour is the point: **money and master-data facts come from
Python, wording and judgement come from the model.** The UI labels every step so
an audience can see which is which.

## Architecture

```
                 Browser (React 18 + MUI 6)
                          │
                          ▼
   ┌──────────────────────────────────────────────┐
   │ Cloud Run  ·  europe-west1                   │
   │   FastAPI: orchestration, SSE, authority pass│
   │   serves the built SPA                       │
   └───────┬───────────────────────────┬──────────┘
           │ streamQuery?alt=sse       │ gs:// upload
           ▼                           ▼
 ┌──────────────────────────┐   ┌─────────────────────────┐
 │ Vertex AI Agent Engine   │   │ GCS  ·  europe-west1    │
 │ europe-west1             │◄──┤ order documents         │
 │  MARSSNACK_Extraction_v1 │   └─────────────────────────┘
 │  MARSSNACK_Validation_v1 │
 └────────────┬─────────────┘
              │  inference only
              ▼
   Gemini 3.x  ·  global endpoint
```

| Piece | Where |
|---|---|
| Agents | Vertex AI Agent Engine, `europe-west1` — `MARSSNACK_Extraction_v1` (`2551293586951897088`), `MARSSNACK_Validation_v1` (`7325095997825089536`) |
| API + UI | Cloud Run, `europe-west1`, service `mars-snack-orders` |
| Documents | `gs://fieldops-agentic-poc-eu-marssnack-staging`, `europe-west1` |
| Inference | Google's **global** endpoint (see below) |

### Why two engines instead of one SequentialAgent

Two reasons, both deliberate:

- **The PDF never reaches the pro model.** Only the flash extractor receives the
  document. The validator sees extracted fields, which keeps the expensive model's
  context small and bounds what each agent can see.
- **Python has to sit between and after them.** The authority pass runs after
  validation, and `revalidate()` (used when a human corrects a field) re-derives
  the whole outcome **with no model call at all**. A single sequential agent gives
  you nowhere to put that.

### `agent_pkg` is shared, not copied

`agent_pkg/` holds the tools, the master data, the schemas, and both agent
definitions. It is deployed to Agent Engine **and** baked into the Cloud Run
image. The authority pass therefore runs literally the same `lookup_client`,
`recompute_totals` and `validate_vat_id` code, against the same seed files, as
the agent did. If they were separate copies, "Python re-checked it" would be a
weaker claim than it sounds.

Each agent module exposes `root_agent`, ADK's convention.

## The models

| Agent | Model | Tools |
|---|---|---|
| Ingestion & Extraction | `gemini-3.8-flash` | none (response schema only) |
| Validation & Reconciliation | `gemini-3.1-pro-preview` | `lookup_client`, `lookup_item`, `suggest_item`, `recompute_totals`, `validate_vat_id`, `screen_sanctions` |

**Gemini 3.x only, with no fallback.** If a model is not available the run fails
loudly. A silent downgrade to 2.5 would make the demo claim something the audience
is not actually watching.

Two findings from probing the project directly, both recorded in
`agent_pkg/model_router.py`:

1. **`gemini-3-pro-preview` returns 404 in every region** for this project, so the
   pro tier is `gemini-3.1-pro-preview`.
2. **The whole 3.x family is global-endpoint only here.** The engines set
   `GOOGLE_CLOUD_LOCATION=global`.

### What that means for data residency

The engines run in `europe-west1`. Cloud Run runs in `europe-west1`. Uploaded
documents sit in a `europe-west1` bucket. **The model call itself is served from
Google's global pool**, because that is the only endpoint serving Gemini 3.x for
this project. The UI states this on the compliance strip rather than implying
EU-only inference. For a production system with a hard residency requirement, this
is the constraint to resolve first.

## What is real and what is simulated

**Real:** both Gemini models and both Agent Engine deployments; the PDF reading;
the tool calls; token counts and timings shown in the UI; all money arithmetic
(`Decimal`, `ROUND_HALF_UP`); the Polish NIP checksum; fuzzy item matching; the
document upload to GCS.

**Simulated,** and labelled as such in the UI:

- SharePoint Client List and Item List — local seed files (9 stores, 13 items)
- SharePoint `Bot_Processed` output folder — a local outbox directory
- `zamowienia@royalcanin.com` mailbox sync — not connected; you upload manually
- EU sanctions screening — the shape of the check, with no external call

## Exception handling

Every exception is detected in Python, never left to the model:

| Kind | Trigger |
|---|---|
| `UNKNOWN_MARKT` | store number not in the client list (blocking) |
| `UNMAPPED_ITEM` | supplier item has no Minos mapping |
| `AMBIGUOUS_ITEM` | a candidate exists but is not confident enough to apply |
| `TOTALS_MISMATCH` | the document's stated net/VAT/total disagrees with the recomputation |
| `INVALID_VAT_ID` | prefix, format or NIP checksum fails |
| `SANCTIONS_HIT` | screening is not CLEAR |

A fuzzy item match auto-resolves at **≥ 0.85** confidence with a 0.05 margin over
the runner-up, and says in the audit trail that the agent resolved it. Below
**0.55** a candidate is not shown to the reviewer at all: the nearest store to an
unknown four-digit number is always *some* store, and a one-click "apply" on a 25%
guess teaches reviewers to distrust the queue.

A store number is never auto-applied. It is a commercial fact.

## Running it

```bash
# 1. Agents -> Vertex AI Agent Engine (writes .remote_agents.json)
cd mars-snack
GOOGLE_CLOUD_PROJECT=fieldops-agentic-poc backend/.venv/bin/python deploy_agents.py

# 2. API + UI -> Cloud Run
bash cloudrun-deploy.sh
```

See `DEPLOY.md` for prerequisites, IAM, local development and the deployment
gotchas that cost real time.

Before a demo, refresh the generated samples so their order and delivery dates
sit around the current day rather than whenever they were last built. The real
customer order is left exactly as received and keeps its original date.

```bash
backend/.venv/bin/python samples/order_template.py   # then redeploy
```

## Verification

`backend/verify.py` asserts **93 checks against the deployed engines** — not
against mocks. It runs all three scenarios end to end and checks the extracted
values, every exception, the recomputed money, the audit trail, and the shape of
the agent rail (that every model step names its model, that no tool step claims
one, that both engines appear, that token counts are real).

```bash
cd backend
GOOGLE_CLOUD_PROJECT=fieldops-agentic-poc PYTHONPATH=.. .venv/bin/python verify.py
```

Takes about 100s, because the agents genuinely run three times.

## The UI

React 18 + MUI 6, themed from Mars brand tokens. Three routes: dashboard,
order workbench, exception queue.

The **right-hand agent rail** is the feature that makes the pipeline legible. It
streams over SSE while the run happens and shows, per agent: the model, its tier,
the Agent Engine deployment and region, every step, per-step timings, real token
counts including reasoning tokens, and which tools were called. A model turn that
asks for tools reads `requested 5 tool calls` with their names; a turn that
answers reads `answered`. A finished run can be replayed at a watchable pace.

Fonts are self-hosted (`frontend/public/fonts`), so the UI never depends on a
third-party request that a corporate network might block mid-demo.

## Layout

```
mars-snack/
  agent_pkg/            shared: tools, master data, schemas, agent definitions
    extraction_agent.py   root_agent, flash, response schema
    validation_agent.py   root_agent, pro, six tools
    model_router.py       which model, and the probe table proving availability
    tools.py              the six deterministic tools
    masterdata/           clients.json, items.json  (simulated SharePoint)
  backend/
    app.py                FastAPI: 13 endpoints, SSE, serves the SPA
    orchestrator.py       runs both engines, authority pass, revalidate()
    remote.py             streamQuery over NDJSON + engine events -> rail steps
    reconcile.py          deterministic exception detection and money
    documents.py          PDF staging to GCS
    steps.py, store.py    rail recording, order state
    verify.py             93 assertions against the deployed engines
  frontend/             React 18 + MUI 6 (29 source files)
  samples/              the real order plus two generated exception variants
    order_template.py   regenerates the two; dates follow the day it is run
  Dockerfile            Cloud Run image (must stay at the context root)
  deploy_agents.py      agents -> Agent Engine
  cloudrun-deploy.sh    API + UI -> Cloud Run
```
