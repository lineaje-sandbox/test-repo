"""Calls the deployed agents on Vertex AI Agent Engine and reads their events.

Two jobs:

1. Invoke `streamQuery` on a deployed engine and yield each event.
2. Translate those events into the `AgentStep` records the UI's agent rail shows.

On the transport: this talks to the `:streamQuery?alt=sse` endpoint with plain
HTTP rather than going through the Vertex SDK's streaming helper. The reasoning
engine emits newline-delimited JSON objects, while the SDK's REST stream parser
expects a JSON array and fails on the first chunk.

On the rail: when the agents ran in-process, the steps came from ADK's callbacks.
Now that they run remotely, the steps are derived from what the engine actually
streamed back, which is a more honest account of the remote work. The event shape
below was read off a real deployed engine, not assumed:

    {"model_version": "<approved-model>",
     "author": "extraction",
     "content": {"role": "model", "parts": [
        {"function_call": {"id": ..., "name": ..., "args": {...}}},
        {"function_response": {"id": ..., "name": ..., "response": {...}}},
        {"text": "..."}]},
     "usage_metadata": {"prompt_token_count": 705, "candidates_token_count": 29,
                        "thoughts_token_count": 113, "total_token_count": 847},
     "finish_reason": "STOP", "timestamp": 1789967843.15}
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Any, Iterator, Optional

import requests

from agent_pkg.schemas import AgentStep, StepKind, StepStatus

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parent
# Written by deploy_agents.py. Looked for beside the backend and one level up so
# the same code works in the repo and in the container image.
RESOURCE_CANDIDATES = [
    BACKEND_DIR / ".remote_agents.json",
    BACKEND_DIR.parent / ".remote_agents.json",
]

DEFAULT_ENGINE_LOCATION = "europe-west1"
STREAM_TIMEOUT_S = float(os.environ.get("AGENT_STREAM_TIMEOUT_S", "300"))

# Outbound agent calls may only ever reach Vertex AI. A resource name is read
# from a config file, so it is worth refusing to send a bearer token anywhere
# else even though that file is ours.
_ALLOWED_URL = re.compile(r"^https://[a-z0-9-]+-aiplatform\.googleapis\.com/v1/")

# How tool calls are described in the rail. Without this the rail would read
# "lookup_client", which is an implementation detail rather than work.
TOOL_LABELS: dict[str, str] = {
    "lookup_client": "Look up delivery store in client master",
    "lookup_item": "Map supplier item to Minos ID",
    "suggest_item": "Search for a likely item match",
    "recompute_totals": "Recompute totals from line items",
    "validate_vat_id": "Validate VAT identification number",
    "screen_sanctions": "Screen party against sanctions list",
}


class RemoteAgentError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


def _load_resources() -> dict[str, str]:
    for candidate in RESOURCE_CANDIDATES:
        if candidate.is_file():
            try:
                return json.loads(candidate.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                raise RemoteAgentError(f"{candidate} is not valid JSON: {exc}") from exc
    raise RemoteAgentError(
        "No .remote_agents.json found. Deploy the agents first:\n"
        "  cd mars-snack && backend/.venv/bin/python deploy_agents.py"
    )


_RESOURCES: Optional[dict[str, str]] = None


def resources() -> dict[str, str]:
    global _RESOURCES
    if _RESOURCES is None:
        _RESOURCES = _load_resources()
    return _RESOURCES


def engine_location() -> str:
    return (
        os.environ.get("AGENT_ENGINE_LOCATION")
        or resources().get("_engine_location")
        or DEFAULT_ENGINE_LOCATION
    )


def resource_for(agent_key: str) -> str:
    name = resources().get(agent_key)
    if not name:
        raise RemoteAgentError(
            f"No deployed engine recorded for {agent_key!r}. Known: "
            f"{[k for k in resources() if not k.startswith('_')]}"
        )
    return name


def engine_id(agent_key: str) -> str:
    return resource_for(agent_key).split("/")[-1]


# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------

_CREDENTIALS = None


def _token() -> str:
    """Fetch and refresh ADC. On Cloud Run this is the service account."""
    global _CREDENTIALS
    import google.auth
    from google.auth.transport.requests import Request

    if _CREDENTIALS is None:
        _CREDENTIALS, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
    if not _CREDENTIALS.valid:
        _CREDENTIALS.refresh(Request())
    return _CREDENTIALS.token


# ---------------------------------------------------------------------------
# Streaming
# ---------------------------------------------------------------------------


def stream_agent(
    agent_key: str, message: dict[str, Any], *, user_id: str = "cs-specialist"
) -> Iterator[dict[str, Any]]:
    """Invoke a deployed agent and yield each streamed event.

    `message` is a google.genai `Content` as a dict, so a run can pass a document
    as a `file_data` part alongside its text instruction.
    """
    location = engine_location()
    url = (
        f"https://{location}-aiplatform.googleapis.com/v1/"
        f"{resource_for(agent_key)}:streamQuery?alt=sse"
    )
    if not _ALLOWED_URL.match(url):
        raise RemoteAgentError(f"Refusing to call a non-Vertex URL: {url}")

    body = {
        "class_method": "stream_query",
        "input": {"user_id": user_id, "message": message},
    }

    response = requests.post(
        url,
        json=body,
        headers={"Authorization": f"Bearer {_token()}"},
        stream=True,
        timeout=STREAM_TIMEOUT_S,
    )
    if response.status_code != 200:
        raise RemoteAgentError(
            f"{agent_key} engine returned HTTP {response.status_code}: "
            f"{response.text[:400]}"
        )

    buffer = ""
    for raw in response.iter_lines(decode_unicode=True):
        if not raw:
            continue
        line = raw[len("data:"):].strip() if raw.startswith("data:") else raw.strip()
        if not line:
            continue
        # A single JSON object can be split across lines, so accumulate until it
        # parses rather than discarding a partial chunk.
        buffer = (buffer + line) if buffer else line
        try:
            event = json.loads(buffer)
        except json.JSONDecodeError:
            continue
        buffer = ""
        if not isinstance(event, dict):
            continue
        if event.get("error_code") or event.get("error_message"):
            raise RemoteAgentError(
                f"{agent_key} engine runtime error: "
                f"{str(event.get('error_message'))[:400]}"
            )
        yield event


# ---------------------------------------------------------------------------
# Events -> rail
# ---------------------------------------------------------------------------


def _summarise_args(tool_name: str, args: dict[str, Any]) -> str:
    if not args:
        return ""
    if tool_name == "recompute_totals":
        prices = args.get("unit_prices") or []
        return f"{len(prices)} line(s) at {args.get('vat_rate_pct')}% VAT"
    parts = []
    for key, value in args.items():
        text = str(value)
        if len(text) > 48:
            text = text[:45] + "…"
        parts.append(f"{key}={text}")
    return ", ".join(parts)


def _summarise_result(tool_name: str, result: Any) -> str:
    """One short line describing what came back, in domain terms."""
    if isinstance(result, dict) and "result" in result and len(result) == 1:
        # ADK wraps a plain return value; unwrap before interpreting.
        result = result["result"]
    if not isinstance(result, dict):
        return str(result)[:120]

    if tool_name == "lookup_client":
        if result.get("found"):
            return f"{result.get('markt')} → {result.get('name')} ({result.get('channel')})"
        nearest = result.get("nearest") or []
        if nearest:
            return f"not found; nearest {nearest[0]['markt']} ({nearest[0]['name']})"
        return "not found"

    if tool_name == "lookup_item":
        if result.get("found"):
            return (
                f"{result.get('supplier_item_no')} → Minos {result.get('minos_id')} "
                f"({result.get('classification')})"
            )
        return f"{result.get('supplier_item_no')} has no mapping"

    if tool_name == "suggest_item":
        candidates = result.get("candidates") or []
        if not candidates:
            return "no candidates"
        best = candidates[0]
        verdict = "auto-resolvable" if result.get("auto_resolvable") else "needs a human"
        return (
            f"best {best['supplier_item_no']} — {best['product_name']} at "
            f"{best['confidence']:.2f} ({best['reason']}), {verdict}"
        )

    if tool_name == "recompute_totals":
        return (
            f"net {result.get('net')}, VAT {result.get('vat')}, total {result.get('total')}"
        )

    if tool_name == "validate_vat_id":
        return (
            f"{result.get('vat_id')} {'valid' if result.get('valid') else 'INVALID'} "
            f"— {result.get('reason')}"
        )

    if tool_name == "screen_sanctions":
        return f"{result.get('status')} against {result.get('list_version')} (simulated)"

    keys = list(result)[:4]
    return ", ".join(f"{k}={result[k]}" for k in keys)


class EventTranslator:
    """Turns one agent's streamed events into rail steps.

    Tool timing is derived by pairing a `function_call` with the matching
    `function_response` on the call id, because the engine reports no duration of
    its own.
    """

    def __init__(self, *, agent: str, agent_label: str, model: str, model_card: str):
        self.agent = agent
        self.agent_label = agent_label
        self.model = model
        self.model_card = model_card
        self.texts: list[str] = []
        self.tools_called: list[str] = []
        self.tokens_in = 0
        self.tokens_out = 0
        self.thinking_tokens = 0
        self._call_started: dict[str, float] = {}
        self._call_names: dict[str, str] = {}

    def translate(self, event: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
        """Return a list of (kind, kwargs) for the recorder to emit."""
        emitted: list[tuple[str, dict[str, Any]]] = []
        content = event.get("content") or {}
        parts = content.get("parts") or []
        model_version = event.get("model_version") or self.model
        # A model turn either asks for tools or answers. Saying which is the
        # difference between a rail that explains the agent loop and one that
        # just repeats "responded".
        requested = [
            part["function_call"]["name"]
            for part in parts
            if isinstance(part, dict) and part.get("function_call")
        ]

        usage = event.get("usage_metadata") or {}
        if usage:
            self.tokens_in += int(usage.get("prompt_token_count") or 0)
            self.tokens_out += int(usage.get("candidates_token_count") or 0)
            self.thinking_tokens += int(usage.get("thoughts_token_count") or 0)

        for part in parts:
            if not isinstance(part, dict):
                continue

            call = part.get("function_call")
            if call:
                name = call.get("name") or "tool"
                call_id = str(call.get("id") or name)
                self._call_started[call_id] = time.perf_counter()
                self._call_names[call_id] = name
                continue

            response = part.get("function_response")
            if response:
                name = response.get("name") or "tool"
                call_id = str(response.get("id") or name)
                started = self._call_started.pop(call_id, None)
                elapsed = int((time.perf_counter() - started) * 1000) if started else None
                asked = _summarise_args(name, (response.get("args") or {}))
                got = _summarise_result(name, response.get("response"))
                self.tools_called.append(name)
                emitted.append(
                    (
                        "tool",
                        {
                            "kind": StepKind.TOOL_CALL,
                            "label": TOOL_LABELS.get(name, name),
                            "detail": f"{asked} → {got}" if asked else got,
                            "tool": name,
                            # No model on purpose: this ran as Python inside the
                            # engine, not as a model call.
                            "model": None,
                            "elapsed_ms": elapsed,
                        },
                    )
                )
                continue

            text = part.get("text")
            if text:
                self.texts.append(text)

        if usage:
            turn_in = int(usage.get("prompt_token_count") or 0)
            turn_out = int(usage.get("candidates_token_count") or 0)
            thinking = int(usage.get("thoughts_token_count") or 0)
            detail = f"{turn_in} tokens in, {turn_out} out"
            if thinking:
                detail += f", {thinking} reasoning"

            if requested:
                label = (
                    f"{model_version} requested {len(requested)} tool call"
                    f"{'s' if len(requested) > 1 else ''}"
                )
                detail = f"{', '.join(requested)} — {detail}"
            else:
                label = f"{model_version} answered"

            emitted.append(
                (
                    "model",
                    {
                        "kind": StepKind.MODEL_CALL,
                        "label": label,
                        "detail": detail,
                        "model": model_version,
                        "model_card": self.model_card,
                        "tokens_in": turn_in,
                        "tokens_out": turn_out,
                    },
                )
            )

        return emitted

    def text(self) -> str:
        return "".join(self.texts)


def make_message(text: str, *, pdf_uri: Optional[str] = None) -> dict[str, Any]:
    """Build the Content dict for an engine call.

    A PDF travels as a `gs://` reference rather than inline bytes: the document
    never has to be base64'd through the engine API, and Vertex reads it directly.
    """
    parts: list[dict[str, Any]] = []
    if pdf_uri:
        parts.append(
            enforce(
                {"file_data": {"file_uri": pdf_uri, "mime_type": "application/pdf"}}
            )
        )
    parts.append(enforce({"text": text}))
    return {"role": "user", "parts": parts}
