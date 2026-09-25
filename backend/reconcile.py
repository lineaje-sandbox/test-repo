"""The Python authority pass.

Agent 2 investigates with the tools in `tools.py` and writes the human-facing
prose. This module then recomputes the same facts and wins every disagreement.
That split is the point: if the model mistranscribes a price or invents a Minos
ID, the number on screen is still the computed one, and the discrepancy is
recorded in the audit trail instead of being displayed as truth.

Exception *detection* is entirely deterministic here. Agent 2 only supplies the
wording, and `merge_agent_prose` grafts it on afterwards.
"""

from __future__ import annotations

import copy
from decimal import Decimal
from typing import Any, Iterable, Optional

from agent_pkg.schemas import (
    ClientMatch,
    ExceptionKind,
    ExtractedOrder,
    MatchMethod,
    OrderException,
    Severity,
    TotalsCheck,
    ValidatedLine,
)

from agent_pkg.tools import (
    MONEY_TOLERANCE,
    _dec,
    _f,
    _money,
    lookup_client,
    lookup_item,
    recompute_totals,
    screen_sanctions,
    suggest_item,
    validate_vat_id,
)

DEFAULT_VAT_RATE = Decimal("23")

# Below this similarity a candidate is noise, not advice. The nearest match to an
# unknown four-digit store number is always *some* store, and offering a reviewer
# a one-click "apply" for a 25% match teaches them to distrust the queue. Weak
# candidates are dropped entirely so the row asks for a value instead.
SUGGESTION_FLOOR = 0.55


def _suggestion(best: Optional[dict[str, Any]], score_key: str) -> Optional[dict[str, Any]]:
    """Return `best` only when it is similar enough to be worth showing."""
    if best is None:
        return None
    return best if float(best.get(score_key) or 0.0) >= SUGGESTION_FLOOR else None


def _rate_text(rate: Decimal) -> str:
    """Render a VAT rate as 23 or 22.5, never as 23.0.

    `normalize()` alone turns 23.0 into 2.3E+1, so the 'f' format is required.
    """
    return f"{rate.normalize():f}"


# ---------------------------------------------------------------------------
# Human corrections
# ---------------------------------------------------------------------------


def apply_resolutions(
    extracted: ExtractedOrder, resolutions: Iterable[Any]
) -> tuple[ExtractedOrder, set[str]]:
    """Replay human corrections onto a copy of the extracted order.

    Returns the corrected order and the set of field paths a human touched, so
    the reconciler can mark those matches as HUMAN rather than claiming the
    agent resolved them.
    """
    order = copy.deepcopy(extracted)
    touched: set[str] = set()

    for res in resolutions:
        field = res.field
        value = res.value
        index = res.line_index

        if field.startswith("lines."):
            # Accept both "lines.0.supplier_item_no" and field+line_index.
            parts = field.split(".")
            if len(parts) == 3:
                index = int(parts[1])
                attr = parts[2]
            else:
                attr = parts[-1]
            if index is None or index >= len(order.lines):
                continue
            line = order.lines[index]
            if attr in {"unit_price", "ord_qty", "qty_pcs"}:
                setattr(line, attr, float(_dec(value)))
            else:
                setattr(line, attr, value)
            touched.add(f"lines.{index}.{attr}")
            continue

        if field in {"net_subtotal", "vat_amount", "total", "vat_rate_pct"}:
            setattr(order, field, float(_dec(value)))
        elif hasattr(order, field):
            setattr(order, field, value)
        touched.add(field)

    return order, touched


# ---------------------------------------------------------------------------
# Reconciliation
# ---------------------------------------------------------------------------


def reconcile_client(
    extracted: ExtractedOrder, touched: set[str]
) -> tuple[ClientMatch, list[OrderException]]:
    result = lookup_client(extracted.markt or "")
    exceptions: list[OrderException] = []

    if not extracted.markt:
        return (
            ClientMatch(markt="", matched=False, match_method=MatchMethod.NONE),
            [
                OrderException(
                    kind=ExceptionKind.MISSING_FIELD,
                    severity=Severity.BLOCKING,
                    field="markt",
                    message="No delivery store number was found on the document.",
                    observed=None,
                )
            ],
        )

    if result["found"]:
        match = ClientMatch(
            markt=result["markt"],
            matched=True,
            name=result["name"],
            channel=result["channel"],
            city=result["city"],
            match_method=MatchMethod.HUMAN if "markt" in touched else MatchMethod.EXACT,
        )
        if not result["active"]:
            exceptions.append(
                OrderException(
                    kind=ExceptionKind.UNKNOWN_MARKT,
                    severity=Severity.WARNING,
                    field="markt",
                    message=(
                        f"Store {result['markt']} ({result['name']}) is marked inactive in the "
                        "client list."
                    ),
                    observed=result["markt"],
                )
            )
        return match, exceptions

    nearest = result.get("nearest") or []
    best = _suggestion(nearest[0] if nearest else None, "similarity")
    exceptions.append(
        OrderException(
            kind=ExceptionKind.UNKNOWN_MARKT,
            severity=Severity.BLOCKING,
            field="markt",
            message=(
                f"Store number {extracted.markt} is not in the client list, so the order "
                "cannot be routed to a delivery location."
            ),
            observed=extracted.markt,
            suggestion=best["markt"] if best else None,
            suggestion_label=(
                f"{best['markt']} — {best['name']}" if best else None
            ),
            suggestion_confidence=best["similarity"] if best else None,
            # A store number is a commercial fact, never auto-applied.
            auto_resolvable=False,
        )
    )
    return (
        ClientMatch(
            markt=extracted.markt, matched=False, match_method=MatchMethod.NONE
        ),
        exceptions,
    )


def reconcile_lines(
    extracted: ExtractedOrder, touched: set[str]
) -> tuple[list[ValidatedLine], list[OrderException]]:
    validated: list[ValidatedLine] = []
    exceptions: list[OrderException] = []

    for index, line in enumerate(extracted.lines):
        extended = _money(_dec(line.unit_price) * _dec(line.qty_pcs))
        was_human = f"lines.{index}.supplier_item_no" in touched
        found = lookup_item(line.supplier_item_no)

        if found["found"]:
            validated.append(
                ValidatedLine(
                    line_index=index,
                    supplier_item_no=line.supplier_item_no,
                    description=line.description,
                    minos_id=found["minos_id"],
                    product_name=found["product_name"],
                    classification=found["classification"],
                    match_method=MatchMethod.HUMAN if was_human else MatchMethod.EXACT,
                    match_confidence=1.0,
                    unit_price=_f(_dec(line.unit_price)),
                    qty_pcs=float(_dec(line.qty_pcs)),
                    extended_price=float(extended),
                )
            )
            if not found["active"]:
                exceptions.append(
                    OrderException(
                        kind=ExceptionKind.UNMAPPED_ITEM,
                        severity=Severity.WARNING,
                        field=f"lines.{index}.supplier_item_no",
                        line_index=index,
                        message=(
                            f"{found['product_name']} is delisted in the item list but was "
                            "still ordered."
                        ),
                        observed=line.supplier_item_no,
                    )
                )
            continue

        # Unmapped. Ask for candidates.
        suggestion = suggest_item(line.supplier_item_no, line.description)
        candidates = suggestion["candidates"]
        best = candidates[0] if candidates else None

        if suggestion["auto_resolvable"] and best:
            # The spec asks the agent to resolve minor typos on its own. Do it,
            # but record it as a resolved warning so it stays visible in the
            # audit trail rather than disappearing.
            validated.append(
                ValidatedLine(
                    line_index=index,
                    supplier_item_no=line.supplier_item_no,
                    description=line.description,
                    minos_id=best["minos_id"],
                    product_name=best["product_name"],
                    classification=best["classification"],
                    match_method=MatchMethod.FUZZY,
                    match_confidence=best["confidence"],
                    unit_price=_f(_dec(line.unit_price)),
                    qty_pcs=float(_dec(line.qty_pcs)),
                    extended_price=float(extended),
                )
            )
            exceptions.append(
                OrderException(
                    kind=ExceptionKind.UNMAPPED_ITEM,
                    severity=Severity.WARNING,
                    field=f"lines.{index}.supplier_item_no",
                    line_index=index,
                    message=(
                        f"Item {line.supplier_item_no} is not in the item list; matched to "
                        f"{best['product_name']} ({best['reason']}) and applied automatically."
                    ),
                    observed=line.supplier_item_no,
                    expected=best["supplier_item_no"],
                    suggestion=best["supplier_item_no"],
                    suggestion_label=f"{best['supplier_item_no']} — {best['product_name']}",
                    suggestion_confidence=best["confidence"],
                    auto_resolvable=True,
                    resolved=True,
                    resolved_value=best["supplier_item_no"],
                    resolved_by="validation agent (fuzzy match)",
                )
            )
            continue

        validated.append(
            ValidatedLine(
                line_index=index,
                supplier_item_no=line.supplier_item_no,
                description=line.description,
                minos_id=None,
                product_name=None,
                classification=None,
                match_method=MatchMethod.NONE,
                match_confidence=best["confidence"] if best else 0.0,
                unit_price=_f(_dec(line.unit_price)),
                qty_pcs=float(_dec(line.qty_pcs)),
                extended_price=float(extended),
            )
        )
        shown = _suggestion(best, "confidence")
        exceptions.append(
            OrderException(
                kind=(
                    ExceptionKind.AMBIGUOUS_ITEM
                    if best and best["confidence"] >= 0.6
                    else ExceptionKind.UNMAPPED_ITEM
                ),
                severity=Severity.BLOCKING,
                field=f"lines.{index}.supplier_item_no",
                line_index=index,
                message=(
                    f"Item {line.supplier_item_no} ({line.description}) has no Minos mapping "
                    "and no confident candidate, so it needs a human decision."
                ),
                observed=line.supplier_item_no,
                # `best` still drives match_confidence and the AMBIGUOUS/UNMAPPED
                # split above; only the reviewer-facing suggestion is floored.
                suggestion=shown["supplier_item_no"] if shown else None,
                suggestion_label=(
                    f"{shown['supplier_item_no']} — {shown['product_name']}" if shown else None
                ),
                suggestion_confidence=shown["confidence"] if shown else None,
                auto_resolvable=False,
            )
        )

    return validated, exceptions


def reconcile_totals(
    extracted: ExtractedOrder, lines: list[ValidatedLine]
) -> tuple[TotalsCheck, list[OrderException]]:
    rate = _dec(extracted.vat_rate_pct) if extracted.vat_rate_pct else DEFAULT_VAT_RATE
    computed = recompute_totals(
        unit_prices=[line.unit_price for line in lines],
        quantities=[line.qty_pcs for line in lines],
        vat_rate_pct=float(rate),
    )

    net = _dec(computed["net"])
    vat = _dec(computed["vat"])
    total = _dec(computed["total"])

    stated_net = _dec(extracted.net_subtotal) if extracted.net_subtotal is not None else None
    stated_vat = _dec(extracted.vat_amount) if extracted.vat_amount is not None else None
    stated_total = _dec(extracted.total) if extracted.total is not None else None

    # Quantize before formatting: the stated values arrive as JSON floats, so
    # Decimal(90.0) prints "90.0" and reads as sloppy on a finance screen.
    deltas: list[str] = []
    if stated_net is not None and abs(stated_net - net) > MONEY_TOLERANCE:
        deltas.append(f"net {_money(stated_net)} stated against {_money(net)} recomputed")
    if stated_vat is not None and abs(stated_vat - vat) > MONEY_TOLERANCE:
        deltas.append(f"VAT {_money(stated_vat)} stated against {_money(vat)} recomputed")
    if stated_total is not None and abs(stated_total - total) > MONEY_TOLERANCE:
        deltas.append(f"total {_money(stated_total)} stated against {_money(total)} recomputed")

    check = TotalsCheck(
        net_recomputed=float(net),
        vat_recomputed=float(vat),
        total_recomputed=float(total),
        net_stated=float(stated_net) if stated_net is not None else None,
        vat_stated=float(stated_vat) if stated_vat is not None else None,
        total_stated=float(stated_total) if stated_total is not None else None,
        matches_document=not deltas,
        tolerance=float(MONEY_TOLERANCE),
    )

    exceptions: list[OrderException] = []
    if deltas:
        exceptions.append(
            OrderException(
                kind=ExceptionKind.TOTALS_MISMATCH,
                severity=Severity.BLOCKING,
                field="total",
                message=(
                    "The document's own arithmetic does not reconcile: "
                    + "; ".join(deltas)
                    + f". Recomputed from {len(lines)} line(s) at {_rate_text(rate)}% VAT."
                ),
                observed=str(_money(stated_total)) if stated_total is not None else None,
                expected=str(_money(total)),
                suggestion=str(_money(total)),
                suggestion_label=(
                    f"Use the recomputed total {_money(total)} {extracted.currency}"
                ),
                suggestion_confidence=1.0,
                auto_resolvable=False,
            )
        )
    return check, exceptions


def compliance_audit(extracted: ExtractedOrder) -> tuple[list[str], list[OrderException]]:
    audit: list[str] = []
    exceptions: list[OrderException] = []

    for label, vat_id in (
        ("Buyer", extracted.buyer_vat_id),
        ("Seller", extracted.seller_vat_id),
    ):
        if not vat_id:
            continue
        result = validate_vat_id(vat_id)
        if result["valid"]:
            audit.append(f"{label} VAT ID {vat_id}: {result['reason']}.")
        else:
            audit.append(f"{label} VAT ID {vat_id}: FAILED — {result['reason']}.")
            exceptions.append(
                OrderException(
                    kind=ExceptionKind.VAT_ID_INVALID,
                    severity=Severity.WARNING,
                    field="buyer_vat_id" if label == "Buyer" else "seller_vat_id",
                    message=f"{label} VAT ID {vat_id} failed validation: {result['reason']}.",
                    observed=vat_id,
                )
            )

    if extracted.buyer_name:
        screen = screen_sanctions(extracted.buyer_name, "PL")
        audit.append(
            f"Sanctions screening for {extracted.buyer_name}: {screen['status']} "
            f"against {screen['list_version']} (simulated, no external call)."
        )

    return audit, exceptions


def reconcile(
    extracted: ExtractedOrder, touched: Optional[set[str]] = None
) -> tuple[ClientMatch, list[ValidatedLine], TotalsCheck, list[OrderException], list[str]]:
    """Run every deterministic check. This is the source of truth for the UI."""
    touched = touched or set()
    exceptions: list[OrderException] = []

    if not extracted.order_number:
        exceptions.append(
            OrderException(
                kind=ExceptionKind.MISSING_FIELD,
                severity=Severity.BLOCKING,
                field="order_number",
                message="No order number was found on the document.",
            )
        )

    client, client_exceptions = reconcile_client(extracted, touched)
    lines, line_exceptions = reconcile_lines(extracted, touched)
    totals, totals_exceptions = reconcile_totals(extracted, lines)
    audit, audit_exceptions = compliance_audit(extracted)

    exceptions += client_exceptions + line_exceptions + totals_exceptions + audit_exceptions

    audit.insert(
        0,
        f"Totals recomputed in Python from {len(lines)} line(s): "
        f"net {totals.net_recomputed:.2f}, VAT {totals.vat_recomputed:.2f}, "
        f"total {totals.total_recomputed:.2f} {extracted.currency}.",
    )
    return client, lines, totals, exceptions, audit


def outcome_for(exceptions: list[OrderException]) -> str:
    """READY only when nothing blocking is still open."""
    blocking_open = [
        exc for exc in exceptions if exc.severity == Severity.BLOCKING and not exc.resolved
    ]
    return "EXCEPTION" if blocking_open else "READY"
