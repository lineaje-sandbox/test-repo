"""Builds the ordered list of steps the UI's agent rail renders.

The rail is what makes the agentic flow legible, so the steps have to be honest
about which work was a model call and which was ordinary Python:

* `MODEL_CALL` steps carry the model identifier reported by the engine.
* `TOOL_CALL` steps carry a tool name and deliberately no model, because that is
  how the UI shows that the arithmetic and the master-data lookups were
  deterministic rather than generated.

Steps arrive from two places. Work done on Cloud Run (receiving the document,
uploading it, the authority pass, a human correction) is recorded directly.
Work done inside a deployed agent is translated from the engine's event stream by
`remote.EventTranslator`.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Callable, Optional

from agent_pkg.schemas import AgentStep, StepKind, StepStatus

logger = logging.getLogger(__name__)

StepSink = Callable[[AgentStep], None]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class RunRecorder:
    """Collects the steps for one order run and forwards them to a sink."""

    def __init__(self, sink: Optional[StepSink] = None) -> None:
        self._seq = 0
        self._sink = sink
        self.steps: list[AgentStep] = []
        self.started = time.perf_counter()

    def add(
        self,
        *,
        agent: str,
        agent_label: str,
        kind: StepKind,
        label: str,
        detail: Optional[str] = None,
        model: Optional[str] = None,
        model_card: Optional[str] = None,
        tool: Optional[str] = None,
        elapsed_ms: Optional[int] = None,
        status: StepStatus = StepStatus.DONE,
        tokens_in: Optional[int] = None,
        tokens_out: Optional[int] = None,
    ) -> AgentStep:
        self._seq += 1
        step = AgentStep(
            seq=self._seq,
            agent=agent,
            agent_label=agent_label,
            kind=kind,
            status=status,
            label=label,
            detail=detail,
            model=model,
            model_card=model_card,
            tool=tool,
            elapsed_ms=elapsed_ms,
            started_at=_now_iso(),
            tokens_in=tokens_in,
            tokens_out=tokens_out,
        )
        self.steps.append(step)
        if self._sink is not None:
            try:
                self._sink(step)
            except Exception:  # pragma: no cover - a broken sink must not fail a run
                logger.exception("Step sink raised; continuing")
        return step

    def elapsed_ms(self) -> int:
        return int((time.perf_counter() - self.started) * 1000)
