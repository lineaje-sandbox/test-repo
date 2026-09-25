#!/usr/bin/env python3
"""Generates the three sample purchase orders the demo runs on.

These mirror the layout of the supplied `EU Compliance Order - Royal Canin _
Mars Pitch.pdf` so that all four documents look like they came from the same
buyer, which is what makes the extraction result meaningful rather than a
layout-specific trick.

    ../backend/.venv/bin/python order_template.py

Each document exercises a different path through the agents:

  unmapped item   an unknown store (blocking) plus a mistyped item code the
                  fuzzy matcher should resolve on its own (warning)
  totals mismatch every code maps and the net is correct, but the printed VAT
                  is wrong, so exactly one defect is isolated

The clean path is covered by the real customer document, copied into this folder
as `order-4604568571-original.pdf`, so there is no generated lookalike for it.

Rendered with reportlab rather than headless Chrome: Chrome blocks on first-run
and policy fetches behind the corporate proxy and never returns from
print-to-pdf, and a document generator should not need a browser anyway.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

HERE = Path(__file__).resolve().parent

# ---------------------------------------------------------------------------
# Dates. Derived from the day the documents are generated rather than written
# in, so a sample never arrives stamped with a date months in the past next to
# a "received today" row. Re-run this script before a demo to refresh them.
#
# Weekends are stepped over: a purchase order dated Sunday, or promising
# Saturday delivery, is the kind of detail that invites the wrong question.
# ---------------------------------------------------------------------------


def _shift_working_days(start: date, days: int) -> date:
    """Move `days` working days from `start`, skipping Saturday and Sunday."""
    step = 1 if days >= 0 else -1
    remaining = abs(days)
    current = start
    while remaining or current.weekday() >= 5:
        current += timedelta(days=step)
        if current.weekday() < 5 and remaining:
            remaining -= 1
    return current


def _pl(day: date) -> str:
    """Polish purchase orders print dd.mm.yyyy."""
    return day.strftime("%d.%m.%Y")


_TODAY = date.today()

INK = colors.HexColor("#111111")
BODY = colors.HexColor("#333333")
MUTED = colors.HexColor("#444444")
GRID = colors.HexColor("#999999")
GREEN = colors.HexColor("#0A7D32")

# ---------------------------------------------------------------------------
# Fonts. Arial carries the Polish glyphs (ł, ż, ę, ó); Helvetica's WinAnsi
# encoding does not, so the fallback transliterates rather than emit black boxes.
# ---------------------------------------------------------------------------

FONT = "Helvetica"
FONT_BOLD = "Helvetica-Bold"
_UNICODE_OK = False

_ARIAL = Path("/System/Library/Fonts/Supplemental/Arial.ttf")
_ARIAL_BOLD = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")
if _ARIAL.exists() and _ARIAL_BOLD.exists():
    pdfmetrics.registerFont(TTFont("OrderSans", str(_ARIAL)))
    pdfmetrics.registerFont(TTFont("OrderSans-Bold", str(_ARIAL_BOLD)))
    pdfmetrics.registerFontFamily(
        "OrderSans", normal="OrderSans", bold="OrderSans-Bold"
    )
    FONT, FONT_BOLD = "OrderSans", "OrderSans-Bold"
    _UNICODE_OK = True

_FOLD = str.maketrans(
    {
        "ą": "a", "ć": "c", "ę": "e", "ł": "l", "ń": "n", "ó": "o",
        "ś": "s", "ź": "z", "ż": "z", "Ą": "A", "Ć": "C", "Ę": "E",
        "Ł": "L", "Ń": "N", "Ó": "O", "Ś": "S", "Ź": "Z", "Ż": "Z",
        "ü": "u", "ö": "o", "ä": "a", "ß": "ss", "\u2013": "-", "\u2019": "'",
    }
)


def t(text: str) -> str:
    """Text for the PDF, folded to ASCII only when the font cannot do better."""
    return text if _UNICODE_OK else text.translate(_FOLD)


# ---------------------------------------------------------------------------
# Styles
# ---------------------------------------------------------------------------

S_TITLE = ParagraphStyle(
    "title", fontName=FONT_BOLD, fontSize=20, leading=24,
    alignment=TA_CENTER, textColor=INK,
)
S_SECTION = ParagraphStyle(
    "section", fontName=FONT_BOLD, fontSize=7.6, leading=10, textColor=INK,
)
S_BODY = ParagraphStyle(
    "body", fontName=FONT, fontSize=9.2, leading=12.4, textColor=BODY,
)
S_STRONG = ParagraphStyle("strong", parent=S_BODY, fontName=FONT_BOLD, textColor=INK)
S_TH = ParagraphStyle(
    "th", fontName=FONT_BOLD, fontSize=6.9, leading=8.6, textColor=INK,
)
S_TD = ParagraphStyle("td", fontName=FONT, fontSize=8.8, leading=11, textColor=INK)
S_TD_BOLD = ParagraphStyle("tdb", parent=S_TD, fontName=FONT_BOLD)
S_TOTAL_LABEL = ParagraphStyle(
    "tl", fontName=FONT, fontSize=9.2, leading=12.4,
    alignment=TA_RIGHT, textColor=BODY,
)
S_TOTAL_VALUE = ParagraphStyle("tv", parent=S_TOTAL_LABEL, textColor=INK)
S_GRAND_LABEL = ParagraphStyle("gl", parent=S_TOTAL_LABEL, fontName=FONT_BOLD)
S_GRAND_VALUE = ParagraphStyle("gv", parent=S_TOTAL_VALUE, fontName=FONT_BOLD)
S_AUDIT = ParagraphStyle(
    "audit", fontName=FONT, fontSize=7.2, leading=10, textColor=MUTED,
)
S_AUDIT_HEAD = ParagraphStyle("ah", parent=S_AUDIT, fontName=FONT_BOLD, textColor=INK)


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------


@dataclass
class Line:
    supplier_item_no: str
    internal_ref: str
    description: str
    unit_price: str
    ord_qty: str
    qty_pcs: str


@dataclass
class OrderDoc:
    out_name: str
    order_number: str
    order_date: str
    delivery_date: str
    markt: str
    markt_name: str
    delivery_street: str
    delivery_city: str
    net_subtotal: str
    vat_amount: str
    total: str
    lines: list[Line] = field(default_factory=list)
    buyer_name: str = "Alpha Pet Retailers Sp. z o.o."
    buyer_street: str = "Wybrzeże Gdyńskie 6D"
    buyer_city: str = "M.St. Warszawa, 01-531, Poland"
    buyer_contact: str = "Jan Kowalski (Procurement Lead)"
    buyer_email: str = "orders@alphapet-retailers.eu"
    buyer_vat: str = "PL7010158031"
    buyer_eori: str = "PL701015803100000"
    vat_rate: str = "23"


# The two orders are dated a day apart so they do not read as copies of one
# another, and both promise delivery still ahead of the generation date.
_UNMAPPED_ORDERED = _shift_working_days(_TODAY, -1)
_TOTALS_ORDERED = _shift_working_days(_TODAY, 0)

# Store 9981 is not in the client master. Item 3579009421 is one digit off the
# real 3579009420 and its description matches exactly, so the fuzzy matcher
# should clear it on its own at high confidence.
UNMAPPED = OrderDoc(
    out_name="order-4604568592-unmapped-item.pdf",
    order_number="4604568592",
    order_date=_pl(_UNMAPPED_ORDERED),
    delivery_date=_pl(_shift_working_days(_UNMAPPED_ORDERED, 2)),
    markt="9981",
    markt_name="Maxi Care Gliwice Nowe",
    delivery_street="Zwycięstwa 52",
    delivery_city="44-100 Gliwice, Poland",
    # 24 x 3.55 = 85.20, 2 x 96.20 = 192.40, net 277.60, VAT 23% = 63.85.
    net_subtotal="277.60",
    vat_amount="63.85",
    total="341.45",
    lines=[
        Line("3579009421", "1311655", "RC CCN Coat Care 85g", "3,55 PLN", "2 KOL", "24 ST"),
        Line(
            "313288", "1003120044", "RC INDOOR APPETITE CONTROL 2KG",
            "96,20 PLN", "2 KOL", "2 ST",
        ),
    ],
)

# Every code maps and the net subtotal is right, so exactly one figure is wrong:
# 23% of 369.30 is 84.94, not 90.00, and the stated total carries the error
# forward. One isolated defect reads far more clearly in a demo than three at
# once. Python catches it; the model is never asked to add anything up.
TOTALS = OrderDoc(
    out_name="order-4604568603-totals-mismatch.pdf",
    order_number="4604568603",
    order_date=_pl(_TOTALS_ORDERED),
    delivery_date=_pl(_shift_working_days(_TOTALS_ORDERED, 3)),
    markt="3902",
    markt_name="VetPartners Warszawa Mokotow",
    delivery_street="Puławska 145",
    delivery_city="02-715 Warszawa, Poland",
    # 2 x 142.75 = 285.50, 2 x 41.90 = 83.80, net 369.30 (correct).
    net_subtotal="369.30",
    vat_amount="90.00",
    total="459.30",
    lines=[
        Line(
            "4102770", "2200450031", "RC VETERINARY RENAL RF23 2KG",
            "142,75 PLN", "2 KOL", "2 ST",
        ),
        Line(
            "4102791", "2200450055", "RC VETERINARY URINARY S/O 400G",
            "41,90 PLN", "1 KOL", "2 ST",
        ),
    ],
)

DOCS = [UNMAPPED, TOTALS]


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

PAGE_W, _ = A4
MARGIN = 16 * mm
CONTENT_W = PAGE_W - 2 * MARGIN


def kv(label: str, value: str) -> Paragraph:
    return Paragraph(
        f'<font name="{FONT_BOLD}" color="#111111">{t(label)}:</font> {t(value)}',
        S_BODY,
    )


def section(title: str, rows: list) -> Table:
    """A titled block with the source document's left rule on the heading."""
    head = Table(
        [[Paragraph(t(title), S_SECTION)]],
        colWidths=[CONTENT_W / 2 - 6 * mm],
        style=TableStyle(
            [
                ("LINEBEFORE", (0, 0), (0, 0), 2.2, INK),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        ),
    )
    return Table(
        [[head]] + [[row] for row in rows],
        colWidths=[CONTENT_W / 2 - 6 * mm],
        style=TableStyle(
            [
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (0, 0), 4),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        ),
    )


def two_up(left: Table, right: Table) -> Table:
    return Table(
        [[left, right]],
        colWidths=[CONTENT_W / 2, CONTENT_W / 2],
        style=TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (0, 0), 0),
                ("LEFTPADDING", (1, 0), (1, 0), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        ),
    )


def items_table(doc: OrderDoc) -> Table:
    headers = [
        "Lief. Art. Nr. / Supplier Item No.",
        "Internal Ref.",
        "Art. Bez. / Item Description",
        "PCS / SKU",
        "Ord Qty",
        "Quantity in PCS",
    ]
    data = [[Paragraph(t(h), S_TH) for h in headers]]
    for line in doc.lines:
        data.append(
            [
                Paragraph(t(line.supplier_item_no), S_TD_BOLD),
                Paragraph(t(line.internal_ref), S_TD),
                Paragraph(t(line.description), S_TD),
                Paragraph(t(line.unit_price), S_TD),
                Paragraph(t(line.ord_qty), S_TD),
                Paragraph(t(line.qty_pcs), S_TD_BOLD),
            ]
        )

    widths = [w * mm for w in (31, 23, 53, 23, 21, 27)]
    return Table(
        data,
        colWidths=widths,
        repeatRows=1,
        style=TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.6, GRID),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        ),
    )


def totals_table(doc: OrderDoc) -> Table:
    rows = [
        [
            Paragraph("Net Subtotal (PLN):", S_TOTAL_LABEL),
            Paragraph(t(doc.net_subtotal), S_TOTAL_VALUE),
        ],
        [
            Paragraph(
                f"Applicable VAT ({doc.vat_rate}% Standard Rate):", S_TOTAL_LABEL
            ),
            Paragraph(t(doc.vat_amount), S_TOTAL_VALUE),
        ],
        [
            Paragraph("Total Amount incl. VAT (PLN):", S_GRAND_LABEL),
            Paragraph(t(doc.total), S_GRAND_VALUE),
        ],
    ]
    table = Table(
        rows,
        colWidths=[70 * mm, 28 * mm],
        hAlign="RIGHT",
        style=TableStyle(
            [
                ("ALIGN", (0, 0), (-1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("RIGHTPADDING", (0, 0), (0, -1), 14),
                ("RIGHTPADDING", (1, 0), (1, -1), 0),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LINEABOVE", (0, 2), (-1, 2), 1.2, INK),
                ("TOPPADDING", (0, 2), (-1, 2), 7),
            ]
        ),
    )
    return table


def audit_block() -> Table:
    rows = [
        [Paragraph("EU AI Processing &amp; Compliance Audit Log:", S_AUDIT_HEAD)],
        [
            Paragraph(
                "&bull; Region: GCP Europe (europe-west1) &nbsp;|&nbsp; "
                "Residency Status: Compliant",
                S_AUDIT,
            )
        ],
        [
            Paragraph(
                "&bull; VIES VAT Validation Protocol: Active &nbsp;|&nbsp; "
                "PII Anonymization Guardrail: Enabled",
                S_AUDIT,
            )
        ],
    ]
    return Table(
        rows,
        colWidths=[CONTENT_W],
        style=TableStyle(
            [
                ("LINEABOVE", (0, 0), (-1, 0), 0.6, GRID, None, (2, 2)),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, 0), 8),
                ("TOPPADDING", (0, 1), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ]
        ),
    )


def title_rule() -> Table:
    return Table(
        [[""]],
        colWidths=[CONTENT_W],
        rowHeights=[2],
        style=TableStyle(
            [
                ("LINEBELOW", (0, 0), (-1, -1), 2.2, INK),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        ),
    )


def build_story(doc: OrderDoc) -> list:
    buyer = section(
        "BUYER DETAILS (ORDER FROM)",
        [
            Paragraph(t(doc.buyer_name), S_STRONG),
            Paragraph(t(doc.buyer_street), S_BODY),
            Paragraph(t(doc.buyer_city), S_BODY),
            kv("Contact", doc.buyer_contact),
            kv("Email", doc.buyer_email),
            kv("VAT ID", doc.buyer_vat),
            kv("EORI Number", doc.buyer_eori),
        ],
    )
    delivery = section(
        "DELIVERY LOCATION",
        [
            kv("Markt", f"{doc.markt} ({doc.markt_name})"),
            Paragraph(t(doc.buyer_name), S_BODY),
            Paragraph(t(f"{doc.delivery_street}, {doc.delivery_city}"), S_BODY),
            kv("EORI Number", doc.buyer_eori),
            kv("Compliance Standard", "ISO-22000 (Food Safety)"),
        ],
    )
    seller = section(
        "SELLER DETAILS (ORDER TO)",
        [
            Paragraph(t("Royal Canin Dystrybucja Sp. z o.o."), S_STRONG),
            Paragraph(t("Grabska 10, 32-005 Niepołomice, Poland"), S_BODY),
            kv("Email", "orders.cne@royalcanin.com"),
            kv("KRS", "000008815"),
            kv("VAT ID", "PL6751256430"),
        ],
    )
    meta = section(
        "ORDER METADATA &amp; COMPLIANCE",
        [
            kv("Order Number", doc.order_number),
            kv("Order Date", doc.order_date),
            kv("Delivery Date", doc.delivery_date),
            Paragraph(
                f'<font name="{FONT_BOLD}" color="#111111">Sanctions Screening:</font> '
                f'<font name="{FONT_BOLD}" color="#0A7D32">CLEAR</font> (EU-LIST-2026)',
                S_BODY,
            ),
        ],
    )

    return [
        Paragraph("PURCHASE ORDER", S_TITLE),
        Spacer(1, 5),
        title_rule(),
        Spacer(1, 16),
        two_up(buyer, delivery),
        Spacer(1, 16),
        two_up(seller, meta),
        Spacer(1, 14),
        items_table(doc),
        Spacer(1, 18),
        KeepTogether(totals_table(doc)),
        Spacer(1, 26),
        audit_block(),
    ]


def render(doc: OrderDoc) -> Path:
    out = HERE / doc.out_name
    template = SimpleDocTemplate(
        str(out),
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=f"Purchase Order {doc.order_number}",
        author=doc.buyer_name,
        subject="EU Compliance Order - Royal Canin / Mars",
    )
    template.build(build_story(doc))
    return out


def main() -> None:
    if not _UNICODE_OK:
        print("! Arial not found; Polish characters will be transliterated.")
    for doc in DOCS:
        out = render(doc)
        print(f"  {out.name}  {out.stat().st_size / 1024:.0f} KB")
    # The old Chrome-based flow left HTML behind; keep the directory clean.
    for stale in HERE.glob("*.html"):
        stale.unlink()


if __name__ == "__main__":
    main()
