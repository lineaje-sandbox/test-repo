"""Wire contract shared by the ADK agents, the FastAPI layer and the React client.

Everything the UI renders comes from these models. The agent-activity rail in
particular is a first-class part of the contract: each `AgentStep` names the
agent, the exact model identifier behind it, and whether the step was a model
call or a deterministic tool call, so the audience can see which work Gemini did
and which work plain Python did.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Agent 1 output — extraction
# ---------------------------------------------------------------------------


class ExtractedLine(BaseModel):
    """One order line exactly as it appears on the document."""

    supplier_item_no: str = Field(description="LIEF. ART. NR. printed by the buyer")
    internal_ref: Optional[str] = Field(
        default=None, description="INTERNAL REF. if the buyer printed one"
    )
    description: str
    unit_price: float
    ord_qty: float = Field(description="ORD QTY, the ordered pack count (KOL)")
    qty_pcs: float = Field(description="QUANTITY IN PCS, the billable piece count (ST)")
    uom: Optional[str] = Field(default=None, description="Unit shown for qty_pcs, e.g. ST")


class ExtractedOrder(BaseModel):
    """Structured purchase order. Agent 1 fills this from the PDF alone."""

    order_number: str
    order_date: str
    delivery_date: Optional[str] = None

    markt: str = Field(description="Delivery store number, e.g. 3729")
    markt_name: Optional[str] = None

    buyer_name: Optional[str] = None
    buyer_vat_id: Optional[str] = None
    buyer_eori: Optional[str] = None
    buyer_email: Optional[str] = None

    seller_name: Optional[str] = None
    seller_vat_id: Optional[str] = None

    currency: str = "PLN"
    net_subtotal: Optional[float] = None
    vat_rate_pct: Optional[float] = None
    vat_amount: Optional[float] = None
    total: Optional[float] = None

    compliance_standard: Optional[str] = None
    sanctions_screening: Optional[str] = None

    lines: list[ExtractedLine] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Agent 2 output — validation and reconciliation
# ---------------------------------------------------------------------------


class MatchMethod(str, Enum):
    EXACT = "EXACT"
    FUZZY = "FUZZY"
    HUMAN = "HUMAN"
    NONE = "NONE"


class ExceptionKind(str, Enum):
    UNKNOWN_MARKT = "UNKNOWN_MARKT"
    UNMAPPED_ITEM = "UNMAPPED_ITEM"
    AMBIGUOUS_ITEM = "AMBIGUOUS_ITEM"
    TOTALS_MISMATCH = "TOTALS_MISMATCH"
    VAT_ID_INVALID = "VAT_ID_INVALID"
    MISSING_FIELD = "MISSING_FIELD"


class Severity(str, Enum):
    BLOCKING = "BLOCKING"
    WARNING = "WARNING"


class OrderException(BaseModel):
    """One thing a human may need to look at, stated in plain language."""

    kind: ExceptionKind
    severity: Severity
    field: str = Field(description="Dotted path, e.g. markt or lines.0.supplier_item_no")
    line_index: Optional[int] = None
    message: str = Field(description="One sentence a customer service specialist can act on")
    observed: Optional[str] = None
    expected: Optional[str] = None
    suggestion: Optional[str] = Field(
        default=None, description="Proposed value if the agent found a credible candidate"
    )
    suggestion_label: Optional[str] = None
    suggestion_confidence: Optional[float] = None
    auto_resolvable: bool = False
    resolved: bool = False
    resolved_value: Optional[str] = None
    resolved_by: Optional[str] = None


class ValidatedLine(BaseModel):
    """An order line after master-data reconciliation."""

    line_index: int
    supplier_item_no: str
    description: str
    minos_id: Optional[str] = None
    product_name: Optional[str] = None
    classification: Optional[str] = Field(default=None, description="PSR, VET or STD")
    match_method: MatchMethod = MatchMethod.NONE
    match_confidence: float = 0.0
    unit_price: float = 0.0
    qty_pcs: float = 0.0
    extended_price: float = 0.0


class ClientMatch(BaseModel):
    markt: str
    matched: bool
    name: Optional[str] = None
    channel: Optional[str] = None
    city: Optional[str] = None
    match_method: MatchMethod = MatchMethod.NONE


class TotalsCheck(BaseModel):
    """Recomputed by Python, never by the model."""

    net_recomputed: float
    vat_recomputed: float
    total_recomputed: float
    net_stated: Optional[float] = None
    vat_stated: Optional[float] = None
    total_stated: Optional[float] = None
    matches_document: bool
    tolerance: float = 0.01


class ValidationResult(BaseModel):
    outcome: Literal["READY", "EXCEPTION"]
    client: ClientMatch
    lines: list[ValidatedLine] = Field(default_factory=list)
    totals: TotalsCheck
    exceptions: list[OrderException] = Field(default_factory=list)
    summary: str = Field(description="One or two sentences for the reviewer")
    audit: list[str] = Field(
        default_factory=list, description="Compliance checks performed, for the audit log"
    )


# ---------------------------------------------------------------------------
# Agent activity — what the right-hand rail renders
# ---------------------------------------------------------------------------


class StepKind(str, Enum):
    MODEL_CALL = "MODEL_CALL"
    TOOL_CALL = "TOOL_CALL"
    DECISION = "DECISION"
    IO = "IO"


class StepStatus(str, Enum):
    RUNNING = "RUNNING"
    DONE = "DONE"
    FAILED = "FAILED"


class AgentStep(BaseModel):
    """A single visible unit of agent work.

    `model` is the exact identifier that served the call, so the rail can show
    that extraction ran on flash while reconciliation ran on pro. Tool steps
    carry `model=None` on purpose: that is how the UI shows the arithmetic and
    the master-data lookups were deterministic Python, not a model guess.
    """

    seq: int
    agent: str = Field(description="Agent key, e.g. extraction or validation")
    agent_label: str
    kind: StepKind
    status: StepStatus = StepStatus.DONE
    label: str = Field(description="Short imperative, e.g. 'Look up Markt 3729'")
    detail: Optional[str] = None
    model: Optional[str] = None
    model_card: Optional[str] = None
    tool: Optional[str] = None
    elapsed_ms: Optional[int] = None
    started_at: Optional[str] = None
    tokens_in: Optional[int] = None
    tokens_out: Optional[int] = None


class AgentProfile(BaseModel):
    """Static description of an agent, for the rail header and the About panel."""

    key: str
    label: str
    role: str
    model: str
    model_card: str
    model_tier: Literal["flash", "pro"]
    # Where inference is served. Distinct from where the agent itself runs,
    # because Gemini 3.x is global-endpoint only for this project.
    endpoint_location: str
    tools: list[str] = Field(default_factory=list)
    # Vertex AI Agent Engine deployment. Filled in by the backend, which is the
    # only side that knows which engine it is actually talking to.
    runtime: str = "Vertex AI Agent Engine"
    engine_id: Optional[str] = None
    engine_location: Optional[str] = None


# ---------------------------------------------------------------------------
# Orders
# ---------------------------------------------------------------------------


class OrderStatus(str, Enum):
    RECEIVED = "RECEIVED"
    EXTRACTING = "EXTRACTING"
    VALIDATING = "VALIDATING"
    READY = "READY"
    EXCEPTION = "EXCEPTION"
    APPROVED = "APPROVED"
    FAILED = "FAILED"


class Timings(BaseModel):
    extraction_ms: Optional[int] = None
    validation_ms: Optional[int] = None
    total_ms: Optional[int] = None


class OrderSummary(BaseModel):
    """Row shape for the dashboard and the exception queue."""

    order_id: str
    filename: str
    received_at: str
    status: OrderStatus
    order_number: Optional[str] = None
    markt: Optional[str] = None
    markt_name: Optional[str] = None
    currency: Optional[str] = None
    total: Optional[float] = None
    line_count: int = 0
    exception_count: int = 0
    blocking_count: int = 0
    timings: Timings = Field(default_factory=Timings)


class Order(BaseModel):
    order_id: str
    filename: str
    received_at: str
    status: OrderStatus
    source: str = Field(default="UI_UPLOAD", description="UI_UPLOAD or MAILBOX_SYNC (simulated)")
    pdf_bytes: int = 0
    extracted: Optional[ExtractedOrder] = None
    validation: Optional[ValidationResult] = None
    steps: list[AgentStep] = Field(default_factory=list)
    resolutions: list["Resolution"] = Field(default_factory=list)
    timings: Timings = Field(default_factory=Timings)
    error: Optional[str] = None
    approved_payload: Optional[dict[str, Any]] = None
    approved_path: Optional[str] = None
    approved_at: Optional[str] = None


# ---------------------------------------------------------------------------
# Requests / responses
# ---------------------------------------------------------------------------


class ResolveRequest(BaseModel):
    field: str
    value: str
    line_index: Optional[int] = None
    by: str = "Customer Service Specialist"


class ApproveRequest(BaseModel):
    by: str = "Customer Service Specialist"


class Resolution(BaseModel):
    """A human correction, kept so revalidation can replay it."""

    field: str
    value: str
    line_index: Optional[int] = None
    at: str
    by: str = "Customer Service Specialist"


class UploadResponse(BaseModel):
    order_id: str
    filename: str
    status: OrderStatus


class SampleDoc(BaseModel):
    name: str
    filename: str
    label: str
    blurb: str
    expects: str = Field(description="What this document is meant to demonstrate")


class MasterDataStats(BaseModel):
    clients: int
    items: int
    source: str
    simulated: bool = True


class AppConfig(BaseModel):
    """Drives the compliance strip. Every value is read live, never hardcoded in the UI."""

    app_name: str
    adk_version: str
    endpoint_location: str
    service_region: str
    project_id: str
    # The split the architecture actually has: agents on Agent Engine, API on
    # Cloud Run, documents in a regional bucket.
    agent_runtime: str = "Vertex AI Agent Engine"
    agent_engine_location: str = ""
    api_runtime: str = "Cloud Run"
    document_bucket: str = ""
    document_bucket_location: str = ""
    agents: list[AgentProfile]
    masterdata: MasterDataStats
    residency_note: str
    simulated_integrations: list[str]


class StreamEvent(BaseModel):
    """SSE envelope. `type` selects the payload shape on the client."""

    type: Literal[
        "run.started",
        "agent.started",
        "step",
        "extraction.done",
        "exception.raised",
        "validation.done",
        "order.done",
        "run.error",
        "heartbeat",
    ]
    order_id: str
    ts: str
    elapsed_ms: int
    step: Optional[AgentStep] = None
    agent: Optional[AgentProfile] = None
    extracted: Optional[ExtractedOrder] = None
    validation: Optional[ValidationResult] = None
    exception: Optional[OrderException] = None
    status: Optional[OrderStatus] = None
    message: Optional[str] = None


# `Order` refers to `Resolution`, which is declared later in the file for
# readability, so the forward reference has to be resolved explicitly.
Order.model_rebuild()
