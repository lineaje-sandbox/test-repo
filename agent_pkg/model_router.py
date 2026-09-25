"""Which model backs which agent.

Gemini 3.x only. There is deliberately no 2.5 fallback: a silent downgrade to an
older family would make the demo claim something the audience is not seeing.

Verified against project `fieldops-agentic-poc` on 2026-09-20 with a
generateContent probe (200 = invokable, 404 = not served here):

    model                    global   europe-west1   us-central1
    gemini-3-pro-preview       404        404            404
    gemini-3.1-pro-preview     200        404            404
    gemini-3.8-flash           200        404            404
    gemini-3.7-flash           200        404            404
    gemini-3-flash-preview     200        404            404

Two consequences we live with rather than hide:

1. `gemini-3-pro-preview` is not available to this project in any region, so the
   pro tier is `gemini-3.1-pro-preview`.
2. The whole 3.x family is global-endpoint only. The agents run on Agent Engine in
   europe-west1 and the Cloud Run service and its uploads stay in europe-west1,
   but the model call itself is served from Google's global pool. That is why the
   deployment sets GOOGLE_CLOUD_LOCATION=global on the engines, and why the UI
   says so plainly instead of implying EU-only inference.

Confirmed on a deployed engine in europe-west1 on 2026-09-20: with that env var
set, a europe-west1 engine returned `model_version: gemini-3.8-flash`.
"""

from __future__ import annotations

import os
from typing import Literal

Tier = Literal["flash", "pro"]

# Where Gemini 3.x is actually served for this project. The engines run in a real
# region; only inference is global.
MODEL_ENDPOINT_LOCATION = "global"

MODELS: dict[Tier, str] = {
    "flash": "gemini-3.8-flash",
    "pro": "gemini-3.1-pro-preview",
}

MODEL_CARDS: dict[str, str] = {
    "gemini-3.8-flash": "https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-8-flash",
    "gemini-3.1-pro-preview": "https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-1-pro",
}

AGENT_TIERS: dict[str, Tier] = {
    # Perception against a fixed schema: the fast model is the right tool.
    "extraction": "flash",
    # Judgement a human reads, one call per order: pay for the better model.
    "validation": "pro",
}


class ModelAvailabilityError(RuntimeError):
    """Raised when the configured endpoint cannot serve the Gemini 3.x family."""


def model_for_tier(tier: Tier) -> str:
    """Model id for a tier. MODEL_FLASH / MODEL_PRO override, and must stay 3.x."""
    override = os.environ.get(f"MODEL_{tier.upper()}")
    if override:
        if not override.startswith("gemini-3"):
            raise ModelAvailabilityError(
                f"MODEL_{tier.upper()}={override!r} is not a Gemini 3.x model. "
                "This build is 3.x only; older families are not an accepted fallback."
            )
        return override
    return MODELS[tier]


def model_for_agent(agent: str) -> str:
    return model_for_tier(AGENT_TIERS.get(agent, "flash"))


def tier_for_agent(agent: str) -> Tier:
    return AGENT_TIERS.get(agent, "flash")


def model_card(model: str) -> str:
    return MODEL_CARDS.get(model, f"UNREGISTERED_MODEL:{model}")


def model_endpoint_location() -> str:
    """Inference location for the deployed engines.

    Overridable only to let a future region through once Google serves 3.x there;
    the default is the only value verified to work for this project.
    """
    return os.environ.get("MODEL_ENDPOINT_LOCATION", MODEL_ENDPOINT_LOCATION)
