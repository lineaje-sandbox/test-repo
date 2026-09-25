"""Agent 1 — Ingestion & Extraction.

Reads the order PDF with Gemini's multimodal input and returns a structured
order. This is what replaces the OCR template rules: nothing here depends on
where a field sits on the page, so a layout change does not break extraction.

The model is named, not constructed. Agent Engine deploys this module by pickling
the agent, and a live `genai.Client` would either fail to pickle or, worse, carry
a locally built SSL context into the cloud. The deployment sets
GOOGLE_CLOUD_LOCATION=global instead, which is what puts inference on the only
endpoint serving Gemini 3.x for this project.
"""

from __future__ import annotations

import os

from google.adk.agents import LlmAgent

from .model_router import model_card, tier_for_agent
from .schemas import AgentProfile, ExtractedOrder

AGENT_KEY = "extraction"
AGENT_LABEL = "Ingestion & Extraction"
AGENT_ROLE = "Reads the order document and returns structured fields"
DISPLAY_NAME = "MARSSNACK_Extraction_v1"

INSTRUCTION = """You are the Ingestion and Extraction agent for Royal Canin's CNE customer \
service team. You read a single customer purchase order document and return its contents as \
structured data.

Rules that matter:

1. Transcribe, do not interpret. Report every value exactly as printed. Do not convert \
currencies, do not restate dates in another format, and do not tidy up product descriptions.
2. Never compute a value that is not printed. If the document does not state a subtotal, VAT \
amount or total, leave that field null. Another agent recomputes the arithmetic, and a guessed \
figure there is worse than a missing one.
3. Decimal commas are decimal points. "3,55 PLN" is 3.55. "91,48" is 91.48.
4. Order lines have two different quantities and they are not interchangeable:
   - ord_qty is the ORD QTY column, the number of packs or cases ordered (often marked KOL).
   - qty_pcs is the QUANTITY IN PCS column, the billable piece count (often marked ST).
   Read both from their own columns. Never copy one into the other and never derive one from \
the other.
5. supplier_item_no is the buyer's own code, printed under LIEF. ART. NR. or SUPPLIER ITEM NO. \
internal_ref is the INTERNAL REF. column when the buyer prints one. Keep them in the right \
fields; they are easy to swap and the mapping downstream depends on getting it right.
6. markt is the delivery store number, printed as "Markt:". markt_name is the store name that \
usually follows it in brackets.
7. If a value is genuinely absent or illegible, use null. Do not invent a plausible value.

Return only the structured order.
"""

APPROVED_MODELS = frozenset(
    model.strip()
    for model in os.environ["APPROVED_LLM_MODELS"].split(",")
    if model.strip()
)
MODEL = os.environ["EXTRACTION_MODEL"].strip()
if not MODEL or MODEL not in APPROVED_MODELS:
    raise RuntimeError("EXTRACTION_MODEL must name an organization-approved LLM")


def profile(endpoint_location: str = "global") -> AgentProfile:
    return AgentProfile(
        key=AGENT_KEY,
        label=AGENT_LABEL,
        role=AGENT_ROLE,
        model=MODEL,
        model_card=model_card(MODEL),
        model_tier=tier_for_agent(AGENT_KEY),
        endpoint_location=endpoint_location,
        tools=[],
    )


root_agent = LlmAgent(
    name=AGENT_KEY,
    description=AGENT_ROLE,
    model=MODEL,
    instruction=INSTRUCTION,
    # Structured output, so the contract is enforced by the model rather than by
    # prompt discipline. This agent has no tools, which is what makes a response
    # schema available to it.
    output_schema=ExtractedOrder,
    output_key="extracted_order",
)
