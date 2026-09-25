"""Runs one order through the two deployed agents and reconciles the result.

The agents live on organization-approved remote deployments; this is the Cloud Run side that
drives them. The order of truth is unchanged by them being remote:

    agent 1 transcribes  ->  agent 2 investigates and writes prose
                         ->  reconcile.py recomputes every fact and wins

Why two separate engines rather than one `SequentialAgent`:

* Agent 1 receives the document; agent 2 must not. One shared session would put
  the PDF in the pro model's context on every turn, which costs real money and
  tempts it to re-read the document instead of calling its tools. Agent 2 gets
  only the extracted JSON.
* The Python authority pass has to sit between and after the model work. Explicit
  sequencing keeps that visible rather than hiding it inside a graph.

Both engines are invoked over blocking HTTP in a worker thread, because
`requests` is synchronous and this runs inside an async handler.
"""

from __future__ import annotations

import asyncio
import json
import logging

from lineaje import guardrail
import time
from typing import Any, Optional

from agent_pkg import extraction_agent, validation_agent
from agent_pkg.schemas import (
    ExceptionKind,
    ExtractedOrder,
    OrderException,
    StepKind,
    StepStatus,
    ValidationResult,
)

import documents
import remote
from reconcile import apply_resolutions, outcome_for, reconcile
from steps import RunRecorder

logger = logging.getLogger(__name__)


class PipelineError(RuntimeError):
    pass


# Findings whose wording is left to Python because the sentence is mostly money.
# Asked to describe a totals mismatch, the model writes "90.0 PLN" from the raw
# JSON float; Python already has the figures formatted to the cent.
_PYTHON_WORDED = {ExceptionKind.TOTALS_MISMATCH}


def _parse_extracted(text: str) -> ExtractedOrder:
    """Agent 1 runs with a response schema, so this is normally a plain parse."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.strip()
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise PipelineError(
            f"Extraction agent did not return JSON ({exc}). "
            f"First 200 chars: {cleaned[:200]!r}"
        ) from exc
    return ExtractedOrder.model_validate(payload)


def _extracted_summary(extracted: ExtractedOrder) -> str:
    filled = sum(
        1
        for name, value in extracted.model_dump().items()
        if name != "lines" and value not in (None, "")
    )
    return f"{filled} header field(s), {len(extracted.lines)} line(s)"


def _agent2_prompt(extracted: ExtractedOrder) -> str:
    """Agent 2 sees the extracted order as JSON and nothing else."""
    guarded_document = guardrail.enforce(
        json.dumps(extracted.model_dump(), indent=2, ensure_ascii=False)
    )
    return (
        "Validate this extracted purchase order against master data. Use your tools for "
        "every lookup and for the arithmetic.\n\n"
        + guarded_document
    )


def _merge_prose(
    exceptions: list[OrderException], notes: dict[str, Any]
) -> list[OrderException]:
    """Use the agent's sentence where it wrote one for a deterministic finding.

    The set of exceptions is never taken from the model. Only the wording is, and
    only when it lines up with something Python already found.
    """
    for exc in exceptions:
        if exc.kind in _PYTHON_WORDED:
            continue
        sentence = validation_agent.message_for_field(notes, exc.field)
        if sentence and len(sentence) > 20:
            exc.message = sentence.strip()
    return exceptions


def _fallback_summary(
    extracted: ExtractedOrder, exceptions: list[OrderException], outcome: str
) -> str:
    if outcome == "READY":
        return (
            f"Order {extracted.order_number} reconciles: every line mapped and the "
            "totals match the document."
        )
    blocking = [
        exc
        for exc in exceptions
        if exc.severity.value == "BLOCKING" and not exc.resolved
    ]
    return (
        f"Order {extracted.order_number} needs review: "
        f"{len(blocking)} item(s) could not be resolved automatically."
    )


async def _run_remote_agent(
    *,
    agent_key: str,
    agent_label: str,
    model: str,
    model_card: str,
    message: dict[str, Any],
    recorder: RunRecorder,
) -> tuple[str, remote.EventTranslator]:
    """Stream one deployed agent, recording rail steps as its events arrive."""
    translator = remote.EventTranslator(
        agent=agent_key, agent_label=agent_label, model=model, model_card=model_card
    )

    guarded_message = guardrail.enforce(message)

    def consume() -> None:
        for event in remote.stream_agent(agent_key, guarded_message):
            for _, kwargs in translator.translate(event):
                recorder.add(agent=agent_key, agent_label=agent_label, **kwargs)

    # requests is blocking; keep the event loop free so SSE heartbeats continue.
    await asyncio.to_thread(consume)
    return translator.text(), translator


async def run_pipeline(
    *,
    pdf_bytes: bytes,
    filename: str,
    order_id: str,
    recorder: RunRecorder,
) -> tuple[ExtractedOrder, ValidationResult, dict[str, int]]:
    """Extract, validate and reconcile one order document."""

    recorder.add(
        agent="intake",
        agent_label="Intake",
        kind=StepKind.IO,
        label="Receive document",
        detail=f"{filename}, {len(pdf_bytes) / 1024:.0f} KB",
    )

    started = time.perf_counter()
    pdf_uri = await asyncio.to_thread(documents.upload, order_id, filename, pdf_bytes)
    recorder.add(
        agent="intake",
        agent_label="Intake",
        kind=StepKind.IO,
        label="Stage document for the agents",
        detail=f"{documents.bucket_name()} ({documents.bucket_location()})",
        elapsed_ms=int((time.perf_counter() - started) * 1000),
    )

    # ---- Agent 1: on Agent Engine ---------------------------------------
    profile1 = extraction_agent.profile(remote.engine_location())
    recorder.add(
        agent=profile1.key,
        agent_label=profile1.label,
        kind=StepKind.DECISION,
        label="Start ingestion and extraction",
        detail=(
            f"{profile1.model} on Agent Engine "
            f"{remote.engine_id(profile1.key)} in {remote.engine_location()}"
        ),
        model=profile1.model,
        model_card=profile1.model_card,
    )

    started = time.perf_counter()
    raw, _ = await _run_remote_agent(
        agent_key=profile1.key,
        agent_label=profile1.label,
        model=profile1.model,
        model_card=profile1.model_card,
        message=remote.make_message(
            f"Extract the purchase order from {filename}.", pdf_uri=pdf_uri
        ),
        recorder=recorder,
    )
    extraction_ms = int((time.perf_counter() - started) * 1000)
    extracted = _parse_extracted(raw)

    recorder.add(
        agent=profile1.key,
        agent_label=profile1.label,
        kind=StepKind.DECISION,
        label="Extraction complete",
        detail=_extracted_summary(extracted),
        elapsed_ms=extraction_ms,
    )

    # ---- Agent 2: on Agent Engine ---------------------------------------
    profile2 = validation_agent.profile(remote.engine_location())
    recorder.add(
        agent=profile2.key,
        agent_label=profile2.label,
        kind=StepKind.DECISION,
        label="Start validation and reconciliation",
        detail=(
            f"{profile2.model} on Agent Engine "
            f"{remote.engine_id(profile2.key)} in {remote.engine_location()}"
        ),
        model=profile2.model,
        model_card=profile2.model_card,
    )

    started = time.perf_counter()
    notes_text, _ = await _run_remote_agent(
        agent_key=profile2.key,
        agent_label=profile2.label,
        model=profile2.model,
        model_card=profile2.model_card,
        message=remote.make_message(_agent2_prompt(extracted)),
        recorder=recorder,
    )
    validation_ms = int((time.perf_counter() - started) * 1000)
    notes = validation_agent.parse_notes(notes_text)

    # ---- Python authority pass, here on Cloud Run -----------------------
    client, lines, totals, exceptions, audit = reconcile(extracted)
    exceptions = _merge_prose(exceptions, notes)
    outcome = outcome_for(exceptions)

    claimed = len(notes.get("exceptions") or [])
    found = len(exceptions)
    recorder.add(
        agent=profile2.key,
        agent_label=profile2.label,
        kind=StepKind.TOOL_CALL,
        label="Authority pass: recompute and re-check",
        detail=(
            f"{len(lines)} line(s) re-checked, totals recomputed; "
            f"agent reported {claimed} exception(s), Python derived {found}"
        ),
        tool="reconcile",
    )
    if claimed != found:
        # Worth saying out loud rather than smoothing over: the deterministic
        # result is what the UI shows either way.
        audit.append(
            f"Agent 2 reported {claimed} exception(s); the deterministic pass derived "
            f"{found}. The deterministic result is authoritative and is what is displayed."
        )

    summary = notes.get("summary") or ""
    if len(summary) < 15:
        summary = _fallback_summary(extracted, exceptions, outcome)

    recorder.add(
        agent=profile2.key,
        agent_label=profile2.label,
        kind=StepKind.DECISION,
        label=f"Outcome: {outcome}",
        detail=summary,
        elapsed_ms=validation_ms,
    )

    validation = ValidationResult(
        outcome=outcome,  # type: ignore[arg-type]
        client=client,
        lines=lines,
        totals=totals,
        exceptions=exceptions,
        summary=summary,
        audit=audit,
    )
    timings = {
        "extraction_ms": extraction_ms,
        "validation_ms": validation_ms,
        "total_ms": recorder.elapsed_ms(),
    }
    return extracted, validation, timings


def revalidate(
    extracted: ExtractedOrder,
    resolutions: list[Any],
    previous: Optional[ValidationResult],
) -> ValidationResult:
    """Re-run the deterministic checks after a human correction.

    No agent call: a human has supplied the missing fact, so re-asking Gemini
    would add latency and a chance of contradicting them. Prose from the original
    run is preserved for any exception that is still open.
    """
    corrected, touched = apply_resolutions(extracted, resolutions)
    client, lines, totals, exceptions, audit = reconcile(corrected, touched)
    outcome = outcome_for(exceptions)

    if previous:
        by_field = {exc.field: exc for exc in previous.exceptions}
        for exc in exceptions:
            prior = by_field.get(exc.field)
            if prior and prior.message and prior.kind == exc.kind:
                exc.message = prior.message

    for res in resolutions:
        audit.append(f"{res.by} set {res.field} to {res.value} at {res.at}.")

    summary = (
        f"Order {corrected.order_number} is ready: every exception has been resolved."
        if outcome == "READY"
        else _fallback_summary(corrected, exceptions, outcome)
    )
    return ValidationResult(
        outcome=outcome,  # type: ignore[arg-type]
        client=client,
        lines=lines,
        totals=totals,
        exceptions=exceptions,
        summary=summary,
        audit=audit,
    )
