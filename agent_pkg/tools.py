"""Deterministic tools for Agent 2, plus the Python authority pass.

Everything numeric or factual lives here, in plain Python, for one reason: a
language model must never be the source of truth for money or for a master-data
match. Agent 2 calls these tools to investigate, and the pipeline then re-runs
the same functions as an authority pass, so the values the UI shows are computed,
not generated. The agent's contribution is the judgement and the wording.

Money uses Decimal with ROUND_HALF_UP throughout. Floats are only produced at the
boundary, when handing values to Pydantic.
"""

from __future__ import annotations

import difflib
import json
import re
from decimal import Decimal, ROUND_HALF_UP
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

MASTERDATA_DIR = Path(__file__).resolve().parent / "masterdata"

# A fuzzy candidate at or above this score is offered as a one-click suggestion.
AUTO_SUGGEST_THRESHOLD = 0.85
# Money comparisons tolerate half a grosz of rounding.
MONEY_TOLERANCE = Decimal("0.01")


# ---------------------------------------------------------------------------
# Master data
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def _clients() -> list[dict[str, Any]]:
    data = json.loads((MASTERDATA_DIR / "clients.json").read_text(encoding="utf-8"))
    return data["clients"]


@lru_cache(maxsize=1)
def _items() -> list[dict[str, Any]]:
    data = json.loads((MASTERDATA_DIR / "items.json").read_text(encoding="utf-8"))
    return data["items"]


def clients() -> list[dict[str, Any]]:
    return list(_clients())


def items() -> list[dict[str, Any]]:
    return list(_items())


def masterdata_source() -> str:
    data = json.loads((MASTERDATA_DIR / "clients.json").read_text(encoding="utf-8"))
    return data.get("_source", "simulated")


# ---------------------------------------------------------------------------
# Money helpers
# ---------------------------------------------------------------------------


def _dec(value: Any) -> Decimal:
    """Parse a money-ish value. Accepts 3,55 as well as 3.55."""
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    text = str(value).strip().replace(" ", "")
    # European decimal comma, but only when it is clearly the decimal separator.
    if "," in text and "." not in text:
        text = text.replace(",", ".")
    text = re.sub(r"[^0-9.\-]", "", text)
    if not text or text in {"-", "."}:
        return Decimal("0")
    return Decimal(text)


def _money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _f(value: Decimal) -> float:
    return float(_money(value))


# ---------------------------------------------------------------------------
# Tools exposed to Agent 2
#
# ADK builds the function declarations from these signatures and docstrings, so
# the argument names and the wording matter. Scalars and flat lists only: nested
# object arguments make tool calling noticeably less reliable.
# ---------------------------------------------------------------------------


def lookup_client(markt: str) -> dict[str, Any]:
    """Look up a delivery store (Markt) in the client master list.

    Args:
        markt: The store number printed on the order, for example "3729".

    Returns:
        found: whether the store exists in the master list.
        name, channel, city, legal_entity, vat_id, active: the master record.
        nearest: up to three store numbers that look similar, when not found.
    """
    key = str(markt).strip()
    for client in _clients():
        if client["markt"] == key:
            return {
                "found": True,
                "markt": client["markt"],
                "name": client["name"],
                "channel": client["channel"],
                "city": client["city"],
                "legal_entity": client["legal_entity"],
                "vat_id": client["vat_id"],
                "active": client["active"],
            }

    scored = sorted(
        (
            (difflib.SequenceMatcher(None, key, c["markt"]).ratio(), c)
            for c in _clients()
        ),
        key=lambda pair: pair[0],
        reverse=True,
    )
    return {
        "found": False,
        "markt": key,
        "nearest": [
            {
                "markt": c["markt"],
                "name": c["name"],
                "channel": c["channel"],
                "similarity": round(score, 3),
            }
            for score, c in scored[:3]
        ],
    }


def lookup_item(supplier_item_no: str) -> dict[str, Any]:
    """Map a buyer's supplier item number to the internal Minos ID.

    Args:
        supplier_item_no: The LIEF. ART. NR. printed on the order line.

    Returns:
        found: whether the supplier item number is mapped.
        minos_id, product_name, classification, list_price_pln, active: the master record.
    """
    key = str(supplier_item_no).strip()
    for item in _items():
        if item["supplier_item_no"] == key:
            return {
                "found": True,
                "supplier_item_no": item["supplier_item_no"],
                "minos_id": item["minos_id"],
                "product_name": item["product_name"],
                "classification": item["classification"],
                "list_price_pln": item["list_price_pln"],
                "pack": item["pack"],
                "active": item["active"],
            }
    return {"found": False, "supplier_item_no": key}


def suggest_item(supplier_item_no: str, description: str) -> dict[str, Any]:
    """Find the most likely master item for an unmapped supplier item number.

    Scores candidates on how close the item number is and how close the printed
    description is, so a single mistyped digit on a recognisable product scores
    high while an unrelated code scores low.

    Args:
        supplier_item_no: The unmapped number as printed.
        description: The item description as printed, used as the tie-breaker.

    Returns:
        candidates: up to three candidates, best first, each with a confidence
            between 0 and 1 and the reason it matched.
        auto_resolvable: true when the best candidate is confident and unambiguous.
    """
    key = str(supplier_item_no).strip()
    desc = str(description or "").strip().lower()

    scored: list[tuple[float, dict[str, Any], str]] = []
    for item in _items():
        code_score = difflib.SequenceMatcher(None, key, item["supplier_item_no"]).ratio()
        desc_score = difflib.SequenceMatcher(
            None, desc, item["product_name"].lower()
        ).ratio()

        same_length = len(key) == len(item["supplier_item_no"])
        differing = (
            sum(1 for a, b in zip(key, item["supplier_item_no"]) if a != b)
            if same_length
            else None
        )

        # One transposed or mistyped digit on an otherwise identical code is the
        # single most common real defect, so score it explicitly rather than
        # relying on the generic ratio.
        if differing == 1:
            code_score = max(code_score, 0.97)
            reason = "one digit differs"
        elif differing == 2:
            code_score = max(code_score, 0.88)
            reason = "two digits differ"
        else:
            reason = "similar code"

        confidence = 0.75 * code_score + 0.25 * desc_score
        if desc_score > 0.8:
            reason += " and description matches"
        if not item["active"]:
            confidence *= 0.6
            reason += " (delisted)"

        scored.append((confidence, item, reason))

    scored.sort(key=lambda triple: triple[0], reverse=True)
    top = scored[:3]

    best_score = top[0][0] if top else 0.0
    runner_up = top[1][0] if len(top) > 1 else 0.0
    unambiguous = (best_score - runner_up) >= 0.05

    return {
        "candidates": [
            {
                "supplier_item_no": item["supplier_item_no"],
                "minos_id": item["minos_id"],
                "product_name": item["product_name"],
                "classification": item["classification"],
                "list_price_pln": item["list_price_pln"],
                "active": item["active"],
                "confidence": round(score, 3),
                "reason": reason,
            }
            for score, item, reason in top
        ],
        "auto_resolvable": bool(
            top and best_score >= AUTO_SUGGEST_THRESHOLD and unambiguous and top[0][1]["active"]
        ),
    }


def recompute_totals(
    unit_prices: list[float],
    quantities: list[float],
    vat_rate_pct: float,
) -> dict[str, Any]:
    """Recompute the order totals from the line items.

    This is the arithmetic authority for the whole application. The model is
    never asked to add anything up.

    Args:
        unit_prices: Unit price per line, in document order.
        quantities: Billable piece count per line, same order as unit_prices.
        vat_rate_pct: VAT rate as a percentage, for example 23.

    Returns:
        line_extended: unit_price * quantity per line.
        net, vat, total: the recomputed figures.
    """
    extended = [
        _money(_dec(price) * _dec(qty)) for price, qty in zip(unit_prices, quantities)
    ]
    net = _money(sum(extended, Decimal("0")))
    vat = _money(net * _dec(vat_rate_pct) / Decimal("100"))
    total = _money(net + vat)
    return {
        "line_extended": [float(value) for value in extended],
        "net": float(net),
        "vat": float(vat),
        "total": float(total),
        "vat_rate_pct": float(_dec(vat_rate_pct)),
    }


# Weights for the Polish NIP checksum.
_NIP_WEIGHTS = (6, 5, 7, 2, 3, 4, 5, 6, 7)

_VAT_FORMATS = {
    "PL": r"^\d{10}$",
    "DE": r"^\d{9}$",
    "CZ": r"^\d{8,10}$",
    "FR": r"^[A-Z0-9]{2}\d{9}$",
    "NL": r"^\d{9}B\d{2}$",
    "IT": r"^\d{11}$",
    "ES": r"^[A-Z0-9]\d{7}[A-Z0-9]$",
}


def validate_vat_id(vat_id: str) -> dict[str, Any]:
    """Check an EU VAT identification number's country prefix, format and checksum.

    Polish numbers get a real modulo-11 NIP checksum. Other member states are
    format-checked only.

    Args:
        vat_id: The VAT ID as printed, for example "PL7010158031".

    Returns:
        valid: whether the number passes every check applied.
        country, digits, checks_applied, reason.
    """
    raw = re.sub(r"[\s-]", "", str(vat_id or "")).upper()
    match = re.match(r"^([A-Z]{2})(.+)$", raw)
    if not match:
        return {
            "valid": False,
            "vat_id": raw,
            "reason": "no two-letter country prefix",
            "checks_applied": ["prefix"],
        }

    country, body = match.group(1), match.group(2)
    checks = ["prefix"]

    pattern = _VAT_FORMATS.get(country)
    if pattern:
        checks.append("format")
        if not re.match(pattern, body):
            return {
                "valid": False,
                "vat_id": raw,
                "country": country,
                "reason": f"does not match the {country} format",
                "checks_applied": checks,
            }

    if country == "PL":
        checks.append("nip_checksum")
        digits = [int(ch) for ch in body]
        total = sum(weight * digit for weight, digit in zip(_NIP_WEIGHTS, digits[:9]))
        expected = total % 11
        if expected == 10 or expected != digits[9]:
            return {
                "valid": False,
                "vat_id": raw,
                "country": country,
                "reason": "NIP checksum does not match",
                "checks_applied": checks,
            }

    return {
        "valid": True,
        "vat_id": raw,
        "country": country,
        "digits": body,
        "checks_applied": checks,
        "reason": "passed " + ", ".join(checks),
    }


def screen_sanctions(party_name: str, country: str) -> dict[str, Any]:
    """Screen a trading party against the EU consolidated sanctions list.

    Simulated for this demo: it applies the shape of the check and records the
    list version, but performs no external call. The UI labels it as simulated.

    Args:
        party_name: Legal entity name as printed on the order.
        country: Two-letter country code.

    Returns:
        status: CLEAR or REVIEW.
        list_version, simulated.
    """
    return {
        "status": "CLEAR",
        "party_name": party_name,
        "country": country,
        "list_version": "EU-LIST-2026",
        "simulated": True,
        "note": "No external call performed; screening is simulated for this demo.",
    }


AGENT2_TOOLS = [
    lookup_client,
    lookup_item,
    suggest_item,
    recompute_totals,
    validate_vat_id,
    screen_sanctions,
]

TOOL_NAMES = [fn.__name__ for fn in AGENT2_TOOLS]
