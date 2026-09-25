"""In-memory order store with a small disk mirror, plus the SSE fan-out.

Deliberately not a database. One process, a dict, and JSON on disk so a restart
during a demo does not lose the orders already processed. Cloud Run's filesystem
is ephemeral, which is acceptable here and is stated in the README rather than
papered over.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from agent_pkg.schemas import (
    AgentStep,
    Order,
    OrderStatus,
    OrderSummary,
    Severity,
    StreamEvent,
    Timings,
)

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent / "data"
PDF_DIR = DATA_DIR / "pdf"
ORDER_DIR = DATA_DIR / "orders"
OUTBOX_DIR = Path(__file__).resolve().parent / "outbox" / "Bot_Processed"

for directory in (PDF_DIR, ORDER_DIR, OUTBOX_DIR):
    directory.mkdir(parents=True, exist_ok=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


TERMINAL_STATUSES = frozenset(
    {
        OrderStatus.READY,
        OrderStatus.EXCEPTION,
        OrderStatus.APPROVED,
        OrderStatus.FAILED,
    }
)


class OrderStore:
    def __init__(self) -> None:
        self._orders: dict[str, Order] = {}
        self._subscribers: dict[str, list[asyncio.Queue[StreamEvent]]] = {}
        self._finished: set[str] = set()
        self._load_existing()

    # -- persistence ----------------------------------------------------

    def _load_existing(self) -> None:
        for path in sorted(ORDER_DIR.glob("*.json")):
            try:
                order = Order.model_validate_json(path.read_text(encoding="utf-8"))
                if order.status not in TERMINAL_STATUSES:
                    # A non-terminal order on disk means its run died with the
                    # previous process. Nothing will ever resume it, so leaving
                    # the status alone shows a row that streams forever and an
                    # elapsed time that counts up from the original upload.
                    interrupted_at = order.status.value.lower()
                    order.status = OrderStatus.FAILED
                    order.error = (
                        "Run interrupted: the service restarted while this order was "
                        f"{interrupted_at}. Upload the document again."
                    )
                    self._persist(order)
                    logger.warning("Marked interrupted order %s as FAILED", order.order_id)
                self._orders[order.order_id] = order
                # Every loaded order is terminal by now, so none of them stream.
                self._finished.add(order.order_id)
            except Exception:
                logger.warning("Could not load order file %s", path, exc_info=True)

    def _persist(self, order: Order) -> None:
        try:
            (ORDER_DIR / f"{order.order_id}.json").write_text(
                order.model_dump_json(indent=2), encoding="utf-8"
            )
        except Exception:
            logger.warning("Could not persist order %s", order.order_id, exc_info=True)

    # -- orders ---------------------------------------------------------

    def create(self, filename: str, pdf_bytes: bytes, source: str = "UI_UPLOAD") -> Order:
        order_id = uuid.uuid4().hex[:12]
        (PDF_DIR / f"{order_id}.pdf").write_bytes(pdf_bytes)
        order = Order(
            order_id=order_id,
            filename=filename,
            received_at=now_iso(),
            status=OrderStatus.RECEIVED,
            source=source,
            pdf_bytes=len(pdf_bytes),
        )
        self._orders[order_id] = order
        self._persist(order)
        return order

    def get(self, order_id: str) -> Optional[Order]:
        return self._orders.get(order_id)

    def pdf_path(self, order_id: str) -> Path:
        return PDF_DIR / f"{order_id}.pdf"

    def save(self, order: Order) -> Order:
        self._orders[order.order_id] = order
        self._persist(order)
        return order

    def mark_finished(self, order_id: str) -> None:
        self._finished.add(order_id)

    def is_finished(self, order_id: str) -> bool:
        return order_id in self._finished

    def summaries(self) -> list[OrderSummary]:
        rows: list[OrderSummary] = []
        for order in self._orders.values():
            extracted = order.extracted
            validation = order.validation
            exceptions = validation.exceptions if validation else []
            rows.append(
                OrderSummary(
                    order_id=order.order_id,
                    filename=order.filename,
                    received_at=order.received_at,
                    status=order.status,
                    order_number=extracted.order_number if extracted else None,
                    markt=extracted.markt if extracted else None,
                    markt_name=(
                        validation.client.name
                        if validation and validation.client.name
                        else (extracted.markt_name if extracted else None)
                    ),
                    currency=extracted.currency if extracted else None,
                    total=(
                        validation.totals.total_recomputed
                        if validation
                        else (extracted.total if extracted else None)
                    ),
                    line_count=len(extracted.lines) if extracted else 0,
                    exception_count=len([e for e in exceptions if not e.resolved]),
                    blocking_count=len(
                        [
                            e
                            for e in exceptions
                            if e.severity == Severity.BLOCKING and not e.resolved
                        ]
                    ),
                    timings=order.timings or Timings(),
                )
            )
        rows.sort(key=lambda row: row.received_at, reverse=True)
        return rows

    def write_outbox(self, order_id: str, payload: dict) -> str:
        """Write the approved payload where the RPA process used to drop it."""
        path = OUTBOX_DIR / f"{order_id}.json"
        path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        # Reported relative to the backend root so the UI can show a path that
        # means something without leaking the container's absolute layout.
        return str(path.relative_to(Path(__file__).resolve().parent))

    # -- SSE fan-out ----------------------------------------------------

    def subscribe(self, order_id: str) -> asyncio.Queue[StreamEvent]:
        queue: asyncio.Queue[StreamEvent] = asyncio.Queue(maxsize=512)
        self._subscribers.setdefault(order_id, []).append(queue)
        return queue

    def unsubscribe(self, order_id: str, queue: asyncio.Queue[StreamEvent]) -> None:
        queues = self._subscribers.get(order_id)
        if not queues:
            return
        try:
            queues.remove(queue)
        except ValueError:
            pass
        if not queues:
            self._subscribers.pop(order_id, None)

    def publish(self, event: StreamEvent) -> None:
        for queue in list(self._subscribers.get(event.order_id, [])):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # A client that cannot keep up is dropped rather than allowed to
                # stall the run. It will resync from GET /orders/{id}.
                logger.warning("Dropping SSE frame for a slow subscriber")

    def step_event(self, order_id: str, step: AgentStep, elapsed_ms: int) -> StreamEvent:
        return StreamEvent(
            type="step",
            order_id=order_id,
            ts=now_iso(),
            elapsed_ms=elapsed_ms,
            step=step,
        )


store = OrderStore()
