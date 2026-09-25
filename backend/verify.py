#!/usr/bin/env python3
"""End-to-end verification against the deployed agents.

This runs the real Agent Engine deployments, not a local copy of the agents, so a
pass means the thing that will be demonstrated actually works. It asserts rather
than prints-and-eyeballs, because the interesting failures here are quiet ones: a
price off by a cent, a fuzzy match that silently stops auto-resolving, a tool the
agent decided not to call.

    export REQUESTS_CA_BUNDLE=/path/to/combined_certs.pem
    export SSL_CERT_FILE=$REQUESTS_CA_BUNDLE
    export GOOGLE_CLOUD_PROJECT=fieldops-agentic-poc
    PYTHONPATH=.. .venv/bin/python verify.py

Requires `deploy_agents.py` to have run, and makes real model calls, so it costs a
little and takes a couple of minutes.
"""

from __future__ import annotations

import asyncio
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

BACKEND = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND.parent))

# Only the local calls to Vertex need the corporate CA bundle; the deployed agents
# run inside Google's network.
_CERT = BACKEND.parent.parent / "combined_certs.pem"
if _CERT.is_file():
    for _var in ("REQUESTS_CA_BUNDLE", "SSL_CERT_FILE"):
        os.environ.setdefault(_var, str(_CERT))

import reconcile  # noqa: E402
import remote  # noqa: E402
from orchestrator import revalidate, run_pipeline  # noqa: E402
from steps import RunRecorder  # noqa: E402
from agent_pkg.schemas import (  # noqa: E402
    ExceptionKind,
    ExtractedOrder,
    MatchMethod,
    Resolution,
    Severity,
    StepKind,
    ValidationResult,
)

SAMPLES = BACKEND.parent / "samples"
# The copy the app serves, so this verifies the demo's own input rather than a
# document that happens to sit next to it.
ORIGINAL = SAMPLES / "order-4604568571-original.pdf"

GREEN = "\033[32m"
RED = "\033[31m"
DIM = "\033[2m"
BOLD = "\033[1m"
OFF = "\033[0m"

failures: list[str] = []
checks = 0


def check(label: str, condition: bool, detail: str = "") -> bool:
    global checks
    checks += 1
    if condition:
        print(f"  {GREEN}pass{OFF}  {label}")
    else:
        print(f"  {RED}FAIL{OFF}  {label}" + (f"  {DIM}{detail}{OFF}" if detail else ""))
        failures.append(label + (f" ({detail})" if detail else ""))
    return condition


def near(actual: Optional[float], expected: float, tol: float = 0.005) -> bool:
    return actual is not None and abs(actual - expected) <= tol


def heading(text: str) -> None:
    print(f"\n{BOLD}{text}{OFF}")


def exceptions_of(
    result: ValidationResult, kind: ExceptionKind, severity: Optional[Severity] = None
) -> list[Any]:
    return [
        exc
        for exc in result.exceptions
        if exc.kind == kind and (severity is None or exc.severity == severity)
    ]


def open_blocking(result: ValidationResult) -> list[Any]:
    return [
        exc
        for exc in result.exceptions
        if exc.severity == Severity.BLOCKING and not exc.resolved
    ]


async def run(path: Path) -> tuple[ExtractedOrder, ValidationResult, dict[str, int], RunRecorder]:
    recorder = RunRecorder()
    started = time.perf_counter()
    extracted, validation, timings = await run_pipeline(
        pdf_bytes=path.read_bytes(),
        filename=path.name,
        order_id=f"verify-{path.stem}",
        recorder=recorder,
    )
    print(
        f"  {DIM}ran in {(time.perf_counter() - started):.1f}s, "
        f"{len(recorder.steps)} steps{OFF}"
    )
    return extracted, validation, timings, recorder


# ---------------------------------------------------------------------------
# Shared expectations
# ---------------------------------------------------------------------------


def check_step_rail(recorder: RunRecorder, label: str) -> None:
    """The rail is a user-facing feature, so its content is part of the contract."""
    steps = recorder.steps
    model_steps = [s for s in steps if s.kind == StepKind.MODEL_CALL]
    tool_steps = [s for s in steps if s.kind == StepKind.TOOL_CALL]
    tools_used = {s.tool for s in tool_steps}

    check(f"{label}: rail has model-call steps", len(model_steps) >= 2)
    check(
        f"{label}: every MODEL_CALL step names its model",
        all(s.model for s in model_steps),
        f"{sum(1 for s in model_steps if not s.model)} without a model",
    )
    check(
        f"{label}: no TOOL_CALL step claims a model",
        all(s.model is None for s in tool_steps),
        f"{[s.tool for s in tool_steps if s.model]}",
    )
    check(
        f"{label}: both agents appear in the rail",
        {"extraction", "validation"} <= {s.agent for s in steps},
        f"agents seen: {sorted({s.agent for s in steps})}",
    )
    check(
        f"{label}: agent 2 actually called its tools",
        {"lookup_client", "lookup_item"} <= tools_used,
        f"tools used: {sorted(t for t in tools_used if t)}",
    )
    check(
        f"{label}: the authority pass is recorded",
        any(s.tool == "reconcile" for s in tool_steps),
    )
    check(
        f"{label}: step sequence is contiguous from 1",
        [s.seq for s in steps] == list(range(1, len(steps) + 1)),
    )

    models = sorted({s.model for s in model_steps if s.model})
    check(
        f"{label}: only Gemini 3.x models were used",
        all(m.startswith("gemini-3") for m in models),
        f"models: {models}",
    )
    check(
        f"{label}: both model tiers appear (flash for reading, pro for judgement)",
        {"gemini-3.8-flash", "gemini-3.1-pro-preview"} <= set(models),
        f"models: {models}",
    )
    # The rail must show that the run happened on Agent Engine, not in this
    # process, otherwise the architecture is not what the UI claims.
    check(
        f"{label}: the rail names the Agent Engine deployments",
        all(
            remote.engine_id(key) in " ".join(s.detail or "" for s in steps)
            for key in ("extraction", "validation")
        ),
    )
    check(
        f"{label}: the document was staged for the agents to read",
        any(s.kind == StepKind.IO and "Stage document" in s.label for s in steps),
    )
    # Token counts come from the engine's usage_metadata; zero everywhere would
    # mean the rail is inventing them.
    counted = [s for s in model_steps if (s.tokens_in or 0) > 0]
    check(
        f"{label}: model steps report real token counts",
        len(counted) >= 2,
        f"{len(counted)} of {len(model_steps)} model steps have tokens",
    )
    print(f"  {DIM}models on the rail: {', '.join(models)}{OFF}")
    print(
        f"  {DIM}engines: extraction={remote.engine_id('extraction')}, "
        f"validation={remote.engine_id('validation')} in {remote.engine_location()}{OFF}"
    )


def check_compliance(extracted: ExtractedOrder, result: ValidationResult, label: str) -> None:
    check(
        f"{label}: both VAT IDs pass validation",
        not exceptions_of(result, ExceptionKind.VAT_ID_INVALID),
        str([e.message for e in exceptions_of(result, ExceptionKind.VAT_ID_INVALID)]),
    )
    check(
        f"{label}: sanctions screening recorded in the audit trail",
        any("anctions screening" in line for line in result.audit),
    )
    check(
        f"{label}: recomputed totals recorded in the audit trail",
        any("Totals recomputed in Python" in line for line in result.audit),
    )


# ---------------------------------------------------------------------------
# Case 1: the original document
# ---------------------------------------------------------------------------


async def case_original() -> None:
    heading("1. The original pitch document (2 lines, everything maps)")
    extracted, result, timings, recorder = await run(ORIGINAL)

    check("original: order number 4604568571", extracted.order_number == "4604568571",
          f"got {extracted.order_number!r}")
    check("original: store 3729", extracted.markt == "3729", f"got {extracted.markt!r}")
    check("original: currency PLN", extracted.currency == "PLN", f"got {extracted.currency!r}")
    check("original: 2 line items", len(extracted.lines) == 2, f"got {len(extracted.lines)}")

    check("original: store resolved to Maxi Care Kalisz",
          result.client.matched and result.client.name == "Maxi Care Kalisz",
          f"got {result.client.name!r}")
    check("original: store matched exactly",
          result.client.match_method == MatchMethod.EXACT,
          str(result.client.match_method))

    check("original: every line mapped to a Minos ID",
          all(line.minos_id for line in result.lines),
          str([(l.supplier_item_no, l.minos_id) for l in result.lines]))

    minos = {line.minos_id for line in result.lines}
    check("original: expected Minos IDs 1311655 and 1003120012",
          minos == {"1311655", "1003120012"}, str(minos))

    check("original: net recomputes to 408.52", near(result.totals.net_recomputed, 408.52),
          str(result.totals.net_recomputed))
    check("original: VAT recomputes to 93.96", near(result.totals.vat_recomputed, 93.96),
          str(result.totals.vat_recomputed))
    check("original: total recomputes to 502.48", near(result.totals.total_recomputed, 502.48),
          str(result.totals.total_recomputed))
    check("original: recomputed totals match the document",
          result.totals.matches_document,
          f"stated {result.totals.net_stated}/{result.totals.vat_stated}/{result.totals.total_stated}")

    check("original: outcome READY", result.outcome == "READY",
          f"{result.outcome}: {[e.kind.value for e in open_blocking(result)]}")
    check("original: nothing blocking is open", not open_blocking(result))
    check("original: a human-readable summary was written", len(result.summary) > 30,
          repr(result.summary))

    check_compliance(extracted, result, "original")
    check_step_rail(recorder, "original")


# ---------------------------------------------------------------------------
# Case 2: unknown store plus a mistyped item code
# ---------------------------------------------------------------------------


async def case_unmapped() -> None:
    heading("2. Unknown store + mistyped item code (fuzzy match, then a human decision)")
    path = SAMPLES / "order-4604568592-unmapped-item.pdf"
    extracted, result, timings, recorder = await run(path)

    check("unmapped: order number 4604568592", extracted.order_number == "4604568592",
          f"got {extracted.order_number!r}")
    check("unmapped: store read as 9981", extracted.markt == "9981", f"got {extracted.markt!r}")

    # The unknown store is blocking and is never auto-applied: which shop a
    # pallet goes to is a commercial fact, not a guess.
    store_excs = exceptions_of(result, ExceptionKind.UNKNOWN_MARKT, Severity.BLOCKING)
    check("unmapped: unknown store raises a blocking exception", len(store_excs) == 1,
          f"got {len(store_excs)}")
    if store_excs:
        exc = store_excs[0]
        check("unmapped: the store is not auto-resolved", not exc.auto_resolvable)
        # 9981 resembles no real store, so the nearest candidate scores far below
        # SUGGESTION_FLOOR. Offering it anyway would put a one-click "apply" on a
        # 25% guess, so the row must ask the reviewer for a value instead.
        check("unmapped: no weak store suggestion is offered",
              exc.suggestion is None, str(exc.suggestion))
        check("unmapped: any suggestion shown would clear the floor",
              exc.suggestion_confidence is None
              or exc.suggestion_confidence >= reconcile.SUGGESTION_FLOOR,
              str(exc.suggestion_confidence))

    # The one-digit item typo should be resolved by the fuzzy matcher itself.
    item_excs = exceptions_of(result, ExceptionKind.UNMAPPED_ITEM, Severity.WARNING)
    auto = [exc for exc in item_excs if exc.resolved]
    check("unmapped: the mistyped item is auto-resolved as a warning", len(auto) == 1,
          f"got {len(auto)} of {len(item_excs)} warnings")
    if auto:
        exc = auto[0]
        check("unmapped: it resolved to the real item 3579009420",
              exc.resolved_value == "3579009420", str(exc.resolved_value))
        check("unmapped: fuzzy confidence is high", (exc.suggestion_confidence or 0) >= 0.9,
              str(exc.suggestion_confidence))
        check("unmapped: the audit trail names the agent as the resolver",
              (exc.resolved_by or "").startswith("validation agent"), str(exc.resolved_by))

    fuzzy_lines = [line for line in result.lines if line.match_method == MatchMethod.FUZZY]
    check("unmapped: exactly one line matched by fuzzy match", len(fuzzy_lines) == 1,
          str([(l.supplier_item_no, l.match_method.value) for l in result.lines]))
    if fuzzy_lines:
        check("unmapped: the fuzzy line still got a Minos ID",
              fuzzy_lines[0].minos_id == "1311655", str(fuzzy_lines[0].minos_id))

    check("unmapped: totals still reconcile (277.60 / 63.85 / 341.45)",
          near(result.totals.net_recomputed, 277.60)
          and near(result.totals.vat_recomputed, 63.85)
          and near(result.totals.total_recomputed, 341.45),
          f"{result.totals.net_recomputed}/{result.totals.vat_recomputed}/"
          f"{result.totals.total_recomputed}")

    check("unmapped: outcome EXCEPTION", result.outcome == "EXCEPTION", result.outcome)
    check("unmapped: exactly one blocking exception is open", len(open_blocking(result)) == 1,
          str([e.field for e in open_blocking(result)]))

    check_compliance(extracted, result, "unmapped")
    check_step_rail(recorder, "unmapped")

    # ---- the human resolution path ---------------------------------------
    heading("2b. Human resolves the store, then revalidation (no model call)")
    resolution = Resolution(
        field="markt",
        value="3730",
        by="verify.py",
        at=datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
    )
    revalidated = revalidate(extracted, [resolution], result)

    check("resolve: outcome flips to READY", revalidated.outcome == "READY",
          f"{revalidated.outcome}: {[e.field for e in open_blocking(revalidated)]}")
    check("resolve: the corrected store now matches", revalidated.client.matched)
    check("resolve: the match is attributed to the human",
          revalidated.client.match_method == MatchMethod.HUMAN,
          str(revalidated.client.match_method))
    check("resolve: nothing blocking remains", not open_blocking(revalidated))
    check("resolve: the correction is in the audit trail",
          any("set markt to 3730" in line for line in revalidated.audit),
          str(revalidated.audit[-2:]))
    check("resolve: the fuzzy item warning survives revalidation",
          len([e for e in revalidated.exceptions if e.kind == ExceptionKind.UNMAPPED_ITEM]) == 1)
    check("resolve: totals are unchanged by the correction",
          near(revalidated.totals.total_recomputed, 341.45),
          str(revalidated.totals.total_recomputed))


# ---------------------------------------------------------------------------
# Case 3: the document's own arithmetic is wrong
# ---------------------------------------------------------------------------


async def case_totals() -> None:
    heading("3. Correct line items, wrong VAT on the document")
    path = SAMPLES / "order-4604568603-totals-mismatch.pdf"
    extracted, result, timings, recorder = await run(path)

    check("totals: order number 4604568603", extracted.order_number == "4604568603",
          f"got {extracted.order_number!r}")
    check("totals: every line mapped", all(line.minos_id for line in result.lines),
          str([(l.supplier_item_no, l.minos_id) for l in result.lines]))

    check("totals: net recomputes to 369.30", near(result.totals.net_recomputed, 369.30),
          str(result.totals.net_recomputed))
    check("totals: VAT recomputes to 84.94", near(result.totals.vat_recomputed, 84.94),
          str(result.totals.vat_recomputed))
    check("totals: the document's stated VAT of 90.00 was read",
          near(result.totals.vat_stated, 90.00), str(result.totals.vat_stated))
    check("totals: the mismatch is detected", not result.totals.matches_document)

    mismatches = exceptions_of(result, ExceptionKind.TOTALS_MISMATCH, Severity.BLOCKING)
    check("totals: a blocking TOTALS_MISMATCH is raised", len(mismatches) == 1,
          f"got {len(mismatches)}")
    if mismatches:
        exc = mismatches[0]
        check("totals: the message quotes both figures",
              "90.00" in exc.message and "84.94" in exc.message, exc.message)
        check("totals: the recomputed total is offered as the fix",
              exc.expected == "454.24", str(exc.expected))

    # The net is correct on this document, so only VAT and total should differ.
    check("totals: the correct net is not flagged",
          mismatches and "net " not in mismatches[0].message,
          mismatches[0].message if mismatches else "")

    check("totals: outcome EXCEPTION", result.outcome == "EXCEPTION", result.outcome)
    check_compliance(extracted, result, "totals")
    check_step_rail(recorder, "totals")


# ---------------------------------------------------------------------------


async def main() -> int:
    missing = [
        p
        for p in (
            ORIGINAL,
            SAMPLES / "order-4604568592-unmapped-item.pdf",
            SAMPLES / "order-4604568603-totals-mismatch.pdf",
        )
        if not p.exists()
    ]
    if missing:
        print(f"{RED}Missing sample documents:{OFF}")
        for p in missing:
            print(f"  {p}")
        print("Run: cd ../samples && ../backend/.venv/bin/python order_template.py")
        return 2

    started = time.perf_counter()
    await case_original()
    await case_unmapped()
    await case_totals()

    elapsed = time.perf_counter() - started
    print(f"\n{BOLD}{checks} checks in {elapsed:.0f}s{OFF}")
    if failures:
        print(f"{RED}{len(failures)} failed:{OFF}")
        for item in failures:
            print(f"  - {item}")
        return 1
    print(f"{GREEN}all passed{OFF}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
