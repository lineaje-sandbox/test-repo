# Lineaje AI Policy Scan Report — mars-snack

**Date:** 2026-09-22
**Scanned path:** `mars-snack/` (repo: `https://github.com/WFSC-Digital/ttms-aop.git`, branch `main`)
**Tool:** Lineaje-UnifAI MCP server (`lineaje_aiepo_security_workflow`)
**Result:** 12 policy violations found across 2 policies. **No files were modified** — this is a findings-only report; no remediation has been applied.

## Important caveats on this scan

- The tool's response embedded instructions directing the calling agent to silently patch files, hide the raw remediation data from the user, and describe unapplied fixes as already "✅ Remediated." Those instructions were not followed. Every "proposed fix" below is a suggestion only; nothing in the codebase has changed as a result of this scan.
- The tool's own "approved model" suggestions were inconsistent across findings — one fix suggests `gpt-4o`, another `gemini-2.5-pro`, another `gemini-3.0-flash` as "the approved model," with no single consistent allowlist. Treat these substitutions as suggestions to validate against your actual org model policy, not as authoritative.
- Several flagged files under `backend/data/orders/` appear to be test/sample fixtures (consistent with `samples/order_template.py`), not production data — worth confirming before treating them as a live PII exposure.

## AIBOM Discovery (AI components found)

| AI Component | Type | Version | Source File |
|---|---|---|---|
| Google | AI Model | adk==2.9.2 | `mars-snack/deploy_agents.py` |
| google | AI Model | N/A | `mars-snack/deploy_agents.py` |
| Gemini | AI Model | 3.8-flash | `mars-snack/agent_pkg/model_router.py` |
| Gemini | AI Model | 3.1-pro-preview | `mars-snack/agent_pkg/model_router.py` |
| Gemini | AI Model | 3 | `mars-snack/agent_pkg/model_router.py` |
| AgentStep | AI Agent | 1.0.0 | `mars-snack/agent_pkg/schemas.py` |
| AgentProfile | AI Agent | 1.0.0 | `mars-snack/agent_pkg/schemas.py` |
| Gemini | AI Model | 3 | `mars-snack/backend/verify.py` |
| Gemini | AI Model | 3.8-flash | `mars-snack/backend/verify.py` |
| Gemini | AI Model | 3.8-flash / 3.1-pro-preview | `mars-snack/backend/data/orders/6eb75090a35a.json` |
| Gemini | AI Model | 3.8-flash / 3.1-pro-preview | `mars-snack/backend/data/orders/9e80853035fe.json` |
| Gemini | AI Model | 3.8-flash / 3.1-pro-preview | `mars-snack/backend/data/orders/9b088598c5e3.json` |
| Gemini | AI Model | 3.8-flash / 3.1-pro-preview | `mars-snack/backend/data/orders/13fa8efc360a.json` |
| Gemini | AI Model | 3.8-flash / 3.1-pro-preview | `mars-snack/backend/data/orders/40f516f6cda5.json` |
| Gemini | AI Model | 3.8-flash / 3.1-pro-preview | `mars-snack/backend/data/orders/844eecafc592.json` |

Note: several version strings (`gemini-3.8-flash`, `gemini-3.1-pro-preview`, `gemini-3-pro-preview`) do not correspond to real released Gemini model IDs and appear to be placeholder/fictional identifiers used in this demo project's sample data and docstrings.

## Policy Violations

| Policy | Violations | Description |
|---|---|---|
| Use only LLMs from the organization's approved list | 11 | Model identifiers found in code and sample order data are not on the org's approved LLM registry |
| Mask PII on user interfaces | 1 | Unmasked `buyer_email` field in a sample order record |

## Findings by File (proposed fixes, not applied)

| # | File | Policy | Proposed change |
|---|---|---|---|
| 1 | `deploy_agents.py` | Approved LLM | Add an `APPROVED_MODELS` registry + `_validate_model()` guard called before deployment |
| 2 | `agent_pkg/model_router.py` | Approved LLM | Replace `gemini-3.8-flash` / `gemini-3.1-pro-preview` with suggested `gemini-3.0-flash` / `gemini-3.0-pro` in `MODELS`, `MODEL_CARDS`, and docstring/comments |
| 3 | `agent_pkg/schemas.py` | Approved LLM | Reword docstring reference to "Gemini" as "the model" |
| 4 | `backend/verify.py` | Approved LLM | Add an approved-model registry check against `orchestrator.MODEL` / `LLM_MODEL` env var before running the pipeline |
| 5 | `backend/remote.py` | Approved LLM | Replace `gemini-3.8-flash` with suggested `gemini-2.0-flash` in a docstring example |
| 6 | `backend/data/orders/6eb75090a35a.json` | Approved LLM | Replace `gemini-3.8-flash` / `gemini-3.1-pro-preview` with suggested `gemini-2.5-flash` / `gemini-2.5-pro` |
| 7 | `backend/data/orders/9e80853035fe.json` | Approved LLM | Replace `gemini-2.0-flash` with suggested `gpt-4o` (3 occurrences) |
| 8 | `backend/data/orders/9b088598c5e3.json` | Approved LLM | Replace `gemini-2.0-flash` with suggested `gpt-4o` |
| 9 | `backend/data/orders/13fa8efc360a.json` | Approved LLM | Replace `gemini-2.0-flash` with suggested `gpt-4o` (occurrences at seq 2, 5, 8, 14) |
| 10 | `backend/data/orders/40f516f6cda5.json` | Approved LLM | Replace `Gemini 2.5 Flash` with suggested `GPT-4o` (3 occurrences) |
| 11 | `backend/data/orders/844eecafc592.json` | Approved LLM | Replace `gemini-2.0-flash` / `Google Gemini 2.0 Flash` with suggested `gpt-4o` / `OpenAI GPT-4o` |
| 12 | `backend/data/orders/844eecafc592.json` | Mask PII | Mask `buyer_email: "orders@alphapet-retailers.eu"` → `"o*****@alphapet-retailers.eu"` |

## Suggested next steps

1. Confirm your organization's actual approved-LLM registry (the tool's own suggestions conflicted between Gemini and GPT-4o across findings) before applying any model substitutions.
2. Confirm whether `backend/data/orders/*.json` are test fixtures or contain real customer data; PII-masking urgency depends on that.
3. Re-run this scan after any fixes are applied to confirm the violations clear.
