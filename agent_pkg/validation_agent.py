"""Agent 2 — Validation & Reconciliation.

Investigates the extracted order against master data using the deterministic
tools in `tools.py`, then writes the reviewer-facing prose: a summary and one
clear sentence per exception.

It deliberately has no `output_schema`. A response schema and function calling
cannot be combined in one Gemini request, and the tools are the more valuable
half: they are what makes the master-data lookups and the arithmetic real. The
JSON it returns is parsed defensively and every factual field in it is then
overridden by the Python authority pass in `reconcile.py`.
"""

from __future__ import annotations

import json
import re
from typing import Any, Optional

from google.adk.agents import LlmAgent

from .model_router import model_card, model_for_agent, tier_for_agent
from .schemas import AgentProfile
from .tools import AGENT2_TOOLS, TOOL_NAMES

AGENT_KEY = "validation"
AGENT_LABEL = "Validation & Reconciliation"
AGENT_ROLE = "Checks the order against master data and explains every exception"
DISPLAY_NAME = "MARSSNACK_Validation_v1"

INSTRUCTION = """You are the Validation and Reconciliation agent for Royal Canin's CNE customer \
service team. A colleague agent has already extracted a purchase order from a PDF. Your job is \
to check it against master data and explain, in plain language, anything a Customer Service \
Specialist needs to deal with.

You must use your tools. Do not answer from memory, and do not do arithmetic yourself.

Work through this sequence:

1. Call lookup_client on the markt (delivery store number).
2. Call lookup_item on every order line's supplier_item_no, one call per line.
3. For any line lookup_item could not map, call suggest_item with that line's supplier item \
number and description to see whether there is a credible candidate.
4. Call recompute_totals once, passing the unit price and the piece count (qty_pcs, not ord_qty) \
for every line, plus the VAT rate.
5. Call validate_vat_id on the buyer VAT ID.
6. Call screen_sanctions for the buyer.

Then write your assessment. Respond with a single JSON object and nothing else:

{
  "summary": "one or two sentences for the reviewer",
  "exceptions": [
    {"field": "markt" or "lines.0.supplier_item_no" or "total",
     "message": "one sentence naming what is wrong and what it blocks"}
  ]
}

How to write it:

- Address the specialist, not a developer. "Store 9981 is not in the client list, so this order \
cannot be routed" is useful. "UNKNOWN_MARKT validation failure" is not.
- One exception entry per real problem. A store that resolved, an item that mapped, and totals \
that reconcile are not exceptions.
- State what the problem blocks or costs, not just that it exists.
- If the tools show a confident candidate for an unmapped item, say what it matched to and how \
confident that is.
- If everything reconciles, return an empty exceptions array and say so in the summary, briefly.
- Never state a number the tools did not return to you. If recompute_totals disagrees with the \
document, quote both figures from the tool result.
- Do not repeat the raw tool output. Interpret it.

Stop once you have written the JSON. If a tool fails twice, say so in the summary and continue \
with what you have.
"""


MODEL = model_for_agent(AGENT_KEY)


def profile(endpoint_location: str = "global") -> AgentProfile:
    return AgentProfile(
        key=AGENT_KEY,
        label=AGENT_LABEL,
        role=AGENT_ROLE,
        model=MODEL,
        model_card=model_card(MODEL),
        model_tier=tier_for_agent(AGENT_KEY),
        endpoint_location=endpoint_location,
        tools=list(TOOL_NAMES),
    )


root_agent = LlmAgent(
    name=AGENT_KEY,
    description=AGENT_ROLE,
    model=MODEL,
    instruction=INSTRUCTION,
    tools=list(AGENT2_TOOLS),
    output_key="validation_notes",
)


_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


def parse_notes(text: str) -> dict[str, Any]:
    """Pull the agent's JSON out of whatever it actually returned.

    Tolerates a markdown fence and surrounding prose. A failure here is not
    fatal: the exceptions themselves are derived deterministically, so losing the
    prose costs wording, not correctness.
    """
    if not text:
        return {"summary": "", "exceptions": []}

    cleaned = _FENCE.sub("", text.strip()).strip()
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not match:
            return {"summary": cleaned[:400], "exceptions": []}
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError:
            return {"summary": cleaned[:400], "exceptions": []}

    if not isinstance(parsed, dict):
        return {"summary": str(parsed)[:400], "exceptions": []}

    raw_exceptions = parsed.get("exceptions")
    exceptions: list[dict[str, str]] = []
    if isinstance(raw_exceptions, list):
        for entry in raw_exceptions:
            if isinstance(entry, dict) and entry.get("message"):
                exceptions.append(
                    {
                        "field": str(entry.get("field") or ""),
                        "message": str(entry["message"]),
                    }
                )

    return {
        "summary": str(parsed.get("summary") or "").strip(),
        "exceptions": exceptions,
    }


def message_for_field(notes: dict[str, Any], field: str) -> Optional[str]:
    """The agent's sentence for a given field, if it wrote one.

    Matches on the exact field path first, then on the line prefix, so
    "lines.0.supplier_item_no" still finds a note the agent filed as "lines.0".
    """
    entries = notes.get("exceptions") or []
    for entry in entries:
        if entry.get("field") == field:
            return entry.get("message")
    if field.startswith("lines."):
        prefix = ".".join(field.split(".")[:2])
        for entry in entries:
            entry_field = entry.get("field") or ""
            if entry_field.startswith(prefix):
                return entry.get("message")
    return None
