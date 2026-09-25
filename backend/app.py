"""FastAPI layer: upload a document, watch the agents work, resolve, approve.

Serves the built frontend from `frontend_dist/` so the demo is same-origin and
there is no CORS to explain on stage.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import suppress
from pathlib import Path
from typing import Any, AsyncGenerator, Optional

import google.adk
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

import documents
import remote
from agent_pkg import extraction_agent, validation_agent
from agent_pkg.model_router import model_endpoint_location
from agent_pkg.tools import clients, items, masterdata_source
from agent_pkg.schemas import (
    AppConfig,
    MasterDataStats,
    Order,
    OrderStatus,
    ApproveRequest,
    ResolveRequest,
    Resolution,
    SampleDoc,
    StepKind,
    StreamEvent,
    UploadResponse,
)
from orchestrator import revalidate, run_pipeline
from reconcile import apply_resolutions
from steps import RunRecorder
from store import now_iso, store

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
logger = logging.getLogger("mars_snack")

BACKEND_DIR = Path(__file__).resolve().parent
SAMPLES_DIR = BACKEND_DIR.parent / "samples"
# Resolved, because the SPA handler compares it against a resolved candidate
# path. In the container this is a real directory; locally it is usually a
# symlink to ../frontend/dist, and an unresolved base would never match.
FRONTEND_DIST = (BACKEND_DIR / "frontend_dist").resolve()

MAX_UPLOAD_BYTES = 12 * 1024 * 1024


def project_id() -> str:
    return os.environ.get("GOOGLE_CLOUD_PROJECT", "")


def service_region() -> str:
    """Where this Cloud Run service runs. Cloud Run does not expose its own
    region, so the deploy script passes it in."""
    return os.environ.get("SERVICE_REGION", "europe-west1")

app = FastAPI(title="Royal Canin CNE — Autonomous Order Processing", version="1.0.0")


@app.on_event("startup")
async def startup() -> None:
    # Resolve the deployed engines at boot so a missing deployment is a startup
    # error with an actionable message, rather than a failure inside the first
    # upload of a live demo.
    try:
        engines = {
            key: remote.engine_id(key) for key in ("extraction", "validation")
        }
    except remote.RemoteAgentError as exc:
        logger.error("Agent Engine configuration problem: %s", exc)
        raise
    logger.info(
        "Ready. project=%s engines=%s in %s, inference=%s, docs=%s, adk=%s",
        project_id(),
        engines,
        remote.engine_location(),
        model_endpoint_location(),
        documents.bucket_name(),
        google.adk.__version__,
    )


# ---------------------------------------------------------------------------
# Samples
# ---------------------------------------------------------------------------

# The clean case is the real customer document rather than a generated lookalike;
# the other two are variants of it that each break one thing.
SAMPLE_DOCS: list[SampleDoc] = [
    SampleDoc(
        name="original",
        filename="order-4604568571-original.pdf",
        label="Maxi Care Kalisz — the original order",
        blurb="The actual EU compliance order. Store and both items are on file, and the "
        "document's arithmetic reconciles.",
        expects="Straight through to READY with no exceptions.",
    ),
    SampleDoc(
        name="unmapped-item",
        filename="order-4604568592-unmapped-item.pdf",
        label="Unknown store and a mistyped item code",
        blurb="One item number is a digit off a real product; the delivery store is not on file.",
        expects="One exception auto-resolved by fuzzy match, one blocking exception for a human.",
    ),
    SampleDoc(
        name="totals-mismatch",
        filename="order-4604568603-totals-mismatch.pdf",
        label="VAT that does not add up",
        blurb="Every code maps, but the VAT printed on the document is wrong.",
        expects="A blocking arithmetic exception, caught by Python rather than the model.",
    ),
]


@app.get("/api/samples")
async def get_samples() -> list[SampleDoc]:
    return [doc for doc in SAMPLE_DOCS if (SAMPLES_DIR / doc.filename).is_file()]


# ---------------------------------------------------------------------------
# Config / health
# ---------------------------------------------------------------------------


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "adk_version": google.adk.__version__}


def _profiles() -> list[Any]:
    """Agent profiles, annotated with the engine each one is deployed to."""
    location = model_endpoint_location()
    engine_location = remote.engine_location()
    out = []
    for module in (extraction_agent, validation_agent):
        profile = module.profile(location)
        profile.engine_id = remote.engine_id(profile.key)
        profile.engine_location = engine_location
        out.append(profile)
    return out


@app.get("/api/config")
async def config() -> AppConfig:
    location = model_endpoint_location()
    residency = (
        f"The agents run on Vertex AI Agent Engine in {remote.engine_location()} and this API "
        f"runs on Cloud Run in {service_region()}. Order documents are stored in "
        f"{documents.bucket_name()} ({documents.bucket_location()}). Gemini 3.x is served only "
        "from Google's global endpoint for this project, so the model call itself is not "
        "region-pinned."
        if location == "global"
        else f"Model inference is pinned to {location}."
    )
    return AppConfig(
        app_name="Royal Canin CNE — Autonomous Order Processing",
        adk_version=google.adk.__version__,
        endpoint_location=location,
        service_region=service_region(),
        project_id=project_id(),
        agent_engine_location=remote.engine_location(),
        document_bucket=documents.bucket_name(),
        document_bucket_location=documents.bucket_location(),
        agents=_profiles(),
        masterdata=MasterDataStats(
            clients=len(clients()),
            items=len(items()),
            source=masterdata_source(),
            simulated=True,
        ),
        residency_note=residency,
        simulated_integrations=[
            "SharePoint Client List and Item List (local seed files)",
            "SharePoint Bot_Processed output folder (local outbox)",
            "zamowienia@royalcanin.com mailbox sync (not connected)",
            "EU sanctions screening (shape of the check only, no external call)",
        ],
    )


@app.get("/api/masterdata/clients")
async def masterdata_clients() -> dict[str, Any]:
    return {"source": masterdata_source(), "simulated": True, "clients": clients()}


@app.get("/api/masterdata/items")
async def masterdata_items() -> dict[str, Any]:
    return {"source": masterdata_source(), "simulated": True, "items": items()}


# ---------------------------------------------------------------------------
# Upload + pipeline
# ---------------------------------------------------------------------------


def _start_run(order: Order, pdf_bytes: bytes) -> None:
    """Kick off the agent pipeline for an order as a background task."""

    loop = asyncio.get_running_loop()

    def sink(step) -> None:  # noqa: ANN001 - AgentStep
        # Called from the agent callbacks, already on this loop.
        order.steps.append(step)
        store.publish(store.step_event(order.order_id, step, recorder.elapsed_ms()))

    recorder = RunRecorder(sink=sink)

    async def runner() -> None:
        order.status = OrderStatus.EXTRACTING
        store.save(order)
        store.publish(
            StreamEvent(
                type="run.started",
                order_id=order.order_id,
                ts=now_iso(),
                elapsed_ms=0,
                status=order.status,
            )
        )
        try:
            extracted, validation, timings = await run_pipeline(
                pdf_bytes=pdf_bytes,
                filename=order.filename,
                order_id=order.order_id,
                recorder=recorder,
            )
            order.extracted = extracted
            store.publish(
                StreamEvent(
                    type="extraction.done",
                    order_id=order.order_id,
                    ts=now_iso(),
                    elapsed_ms=recorder.elapsed_ms(),
                    extracted=extracted,
                )
            )
            order.validation = validation
            order.timings.extraction_ms = timings["extraction_ms"]
            order.timings.validation_ms = timings["validation_ms"]
            order.timings.total_ms = timings["total_ms"]
            order.status = (
                OrderStatus.READY if validation.outcome == "READY" else OrderStatus.EXCEPTION
            )
            for exc in validation.exceptions:
                store.publish(
                    StreamEvent(
                        type="exception.raised",
                        order_id=order.order_id,
                        ts=now_iso(),
                        elapsed_ms=recorder.elapsed_ms(),
                        exception=exc,
                    )
                )
            store.publish(
                StreamEvent(
                    type="validation.done",
                    order_id=order.order_id,
                    ts=now_iso(),
                    elapsed_ms=recorder.elapsed_ms(),
                    validation=validation,
                )
            )
        except Exception as exc:  # noqa: BLE001 - surfaced to the client
            logger.exception("Pipeline failed for order %s", order.order_id)
            order.status = OrderStatus.FAILED
            order.error = f"{type(exc).__name__}: {exc}"
            store.publish(
                StreamEvent(
                    type="run.error",
                    order_id=order.order_id,
                    ts=now_iso(),
                    elapsed_ms=recorder.elapsed_ms(),
                    message=order.error,
                )
            )
        finally:
            order.steps = recorder.steps
            store.save(order)
            store.mark_finished(order.order_id)
            store.publish(
                StreamEvent(
                    type="order.done",
                    order_id=order.order_id,
                    ts=now_iso(),
                    elapsed_ms=recorder.elapsed_ms(),
                    status=order.status,
                )
            )

    loop.create_task(runner())


async def _accept(filename: str, pdf_bytes: bytes, source: str) -> UploadResponse:
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(pdf_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
        )
    if not pdf_bytes.startswith(b"%PDF"):
        raise HTTPException(status_code=415, detail="Only PDF documents are accepted.")

    order = store.create(filename, pdf_bytes, source=source)
    _start_run(order, pdf_bytes)
    return UploadResponse(order_id=order.order_id, filename=order.filename, status=order.status)


@app.post("/api/orders/upload")
async def upload(file: UploadFile = File(...)) -> UploadResponse:
    data = await file.read()
    return await _accept(file.filename or "order.pdf", data, "UI_UPLOAD")


@app.post("/api/orders/upload-sample")
async def upload_sample(body: dict[str, str]) -> UploadResponse:
    name = body.get("name", "")
    doc = next((d for d in SAMPLE_DOCS if d.name == name), None)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"Unknown sample {name!r}.")
    path = SAMPLES_DIR / doc.filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"Sample file {doc.filename} is missing.")
    return await _accept(doc.filename, path.read_bytes(), "SAMPLE")


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


@app.get("/api/orders")
async def list_orders() -> list[Any]:
    return store.summaries()


@app.get("/api/orders/{order_id}")
async def get_order(order_id: str) -> Order:
    order = store.get(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Unknown order.")
    return order


@app.get("/api/orders/{order_id}/pdf")
async def get_order_pdf(order_id: str) -> FileResponse:
    order = store.get(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Unknown order.")
    path = store.pdf_path(order_id)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Document not stored.")
    return FileResponse(
        path,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{order.filename}"'},
    )


@app.get("/api/orders/{order_id}/stream")
async def stream(order_id: str, request: Request) -> StreamingResponse:
    """SSE. Replays recorded steps first, so a late join or a refresh is correct."""
    order = store.get(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Unknown order.")

    queue = store.subscribe(order_id)

    async def frames() -> AsyncGenerator[str, None]:
        def frame(event: StreamEvent) -> str:
            return f"event: {event.type}\ndata: {event.model_dump_json()}\n\n"

        try:
            # Replay what already happened.
            for step in list(order.steps):
                yield frame(store.step_event(order_id, step, step.elapsed_ms or 0))
            if order.extracted is not None:
                yield frame(
                    StreamEvent(
                        type="extraction.done",
                        order_id=order_id,
                        ts=now_iso(),
                        elapsed_ms=order.timings.extraction_ms or 0,
                        extracted=order.extracted,
                    )
                )
            if order.validation is not None:
                yield frame(
                    StreamEvent(
                        type="validation.done",
                        order_id=order_id,
                        ts=now_iso(),
                        elapsed_ms=order.timings.total_ms or 0,
                        validation=order.validation,
                    )
                )
            if store.is_finished(order_id):
                yield frame(
                    StreamEvent(
                        type="order.done",
                        order_id=order_id,
                        ts=now_iso(),
                        elapsed_ms=order.timings.total_ms or 0,
                        status=order.status,
                    )
                )
                return

            # Then follow live.
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield (
                        "event: heartbeat\n"
                        f'data: {{"type":"heartbeat","order_id":"{order_id}",'
                        f'"ts":"{now_iso()}","elapsed_ms":0}}\n\n'
                    )
                    continue
                yield frame(event)
                if event.type in {"order.done", "run.error"}:
                    break
        finally:
            store.unsubscribe(order_id, queue)

    return StreamingResponse(
        frames(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            # Cloud Run sits behind a proxy that will otherwise buffer the stream.
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Human in the loop
# ---------------------------------------------------------------------------


@app.post("/api/orders/{order_id}/resolve")
async def resolve(order_id: str, body: ResolveRequest) -> Order:
    order = store.get(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Unknown order.")
    if order.extracted is None:
        raise HTTPException(status_code=409, detail="This order has not been extracted yet.")
    if not body.value.strip():
        raise HTTPException(status_code=400, detail="A value is required.")

    resolution = Resolution(
        field=body.field,
        value=body.value.strip(),
        line_index=body.line_index,
        at=now_iso(),
        by=body.by,
    )
    order.resolutions.append(resolution)

    recorder = RunRecorder()
    recorder.add(
        agent="human",
        agent_label=body.by,
        kind=StepKind.DECISION,
        label="Human resolution applied",
        detail=f"{body.field} set to {resolution.value}",
    )

    order.validation = revalidate(order.extracted, order.resolutions, order.validation)
    order.status = (
        OrderStatus.READY if order.validation.outcome == "READY" else OrderStatus.EXCEPTION
    )
    order.steps = order.steps + recorder.steps
    store.save(order)
    return order


@app.post("/api/orders/{order_id}/approve")
async def approve(
    order_id: str, body: Optional[ApproveRequest] = None
) -> dict[str, Any]:
    # The body is optional so a plain POST still works; avoid a shared default
    # instance as the function default.
    body = body or ApproveRequest()
    order = store.get(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Unknown order.")
    if order.validation is None or order.extracted is None:
        raise HTTPException(status_code=409, detail="This order has not been validated yet.")
    if order.validation.outcome != "READY":
        raise HTTPException(
            status_code=409,
            detail="This order still has blocking exceptions and cannot be released.",
        )

    corrected, _ = apply_resolutions(order.extracted, order.resolutions)
    payload = {
        "order_number": corrected.order_number,
        "order_date": corrected.order_date,
        "delivery_date": corrected.delivery_date,
        "markt": corrected.markt,
        "store_name": order.validation.client.name,
        "channel": order.validation.client.channel,
        "buyer": corrected.buyer_name,
        "buyer_vat_id": corrected.buyer_vat_id,
        "currency": corrected.currency,
        "lines": [
            {
                "minos_id": line.minos_id,
                "supplier_item_no": line.supplier_item_no,
                "product_name": line.product_name,
                "classification": line.classification,
                "quantity_pcs": line.qty_pcs,
                "unit_price": line.unit_price,
                "extended_price": line.extended_price,
                "match_method": line.match_method.value,
            }
            for line in order.validation.lines
        ],
        "net": order.validation.totals.net_recomputed,
        "vat": order.validation.totals.vat_recomputed,
        "total": order.validation.totals.total_recomputed,
        "audit": order.validation.audit,
        "released_at": now_iso(),
        "released_by": body.by,
    }

    path = store.write_outbox(order_id, payload)
    order.approved_payload = payload
    order.approved_path = path
    order.approved_at = now_iso()
    order.status = OrderStatus.APPROVED
    store.save(order)
    return {"payload": payload, "path": path}


# ---------------------------------------------------------------------------
# Static frontend (mounted last so /api always wins)
# ---------------------------------------------------------------------------

if FRONTEND_DIST.is_dir():
    # Mounted before the catch-all: routes match in registration order, so a
    # catch-all registered first would swallow every hashed asset request.
    assets = FRONTEND_DIST / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}")
    async def spa(full_path: str) -> Any:
        """Serve the SPA, falling back to index.html for client-side routes."""
        candidate = (FRONTEND_DIST / full_path).resolve()
        if full_path and FRONTEND_DIST in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")

else:

    @app.get("/")
    async def root() -> JSONResponse:
        return JSONResponse(
            {
                "app": "Royal Canin CNE — Autonomous Order Processing",
                "note": "Frontend not built. Run npm run build and copy dist to backend/frontend_dist.",
                "api": ["/api/health", "/api/config", "/api/samples", "/api/orders"],
            }
        )
