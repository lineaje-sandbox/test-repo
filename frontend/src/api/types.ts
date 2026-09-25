/**
 * Wire contract, mirrored field-for-field from backend/schemas.py.
 *
 * Every name here is snake_case on purpose: the client does no key remapping, so
 * a rename on the Python side surfaces as a TypeScript error rather than an
 * `undefined` on screen.
 */

// ---------------------------------------------------------------------------
// Agent 1 output — extraction
// ---------------------------------------------------------------------------

export interface ExtractedLine {
  supplier_item_no: string;
  internal_ref: string | null;
  description: string;
  unit_price: number;
  ord_qty: number;
  qty_pcs: number;
  uom: string | null;
}

export interface ExtractedOrder {
  order_number: string;
  order_date: string;
  delivery_date: string | null;

  markt: string;
  markt_name: string | null;

  buyer_name: string | null;
  buyer_vat_id: string | null;
  buyer_eori: string | null;
  buyer_email: string | null;

  seller_name: string | null;
  seller_vat_id: string | null;

  currency: string;
  net_subtotal: number | null;
  vat_rate_pct: number | null;
  vat_amount: number | null;
  total: number | null;

  compliance_standard: string | null;
  sanctions_screening: string | null;

  lines: ExtractedLine[];
}

// ---------------------------------------------------------------------------
// Agent 2 output — validation and reconciliation
// ---------------------------------------------------------------------------

export type MatchMethod = 'EXACT' | 'FUZZY' | 'HUMAN' | 'NONE';

export const MATCH_METHODS: readonly MatchMethod[] = ['EXACT', 'FUZZY', 'HUMAN', 'NONE'];

export type ExceptionKind =
  | 'UNKNOWN_MARKT'
  | 'UNMAPPED_ITEM'
  | 'AMBIGUOUS_ITEM'
  | 'TOTALS_MISMATCH'
  | 'VAT_ID_INVALID'
  | 'MISSING_FIELD';

export type Severity = 'BLOCKING' | 'WARNING';

export interface OrderException {
  kind: ExceptionKind;
  severity: Severity;
  /** Dotted path, e.g. `markt` or `lines.0.supplier_item_no`. */
  field: string;
  line_index: number | null;
  message: string;
  observed: string | null;
  expected: string | null;
  suggestion: string | null;
  suggestion_label: string | null;
  suggestion_confidence: number | null;
  auto_resolvable: boolean;
  resolved: boolean;
  resolved_value: string | null;
  resolved_by: string | null;
}

export interface ValidatedLine {
  line_index: number;
  supplier_item_no: string;
  description: string;
  minos_id: string | null;
  product_name: string | null;
  /** PSR, VET or STD. */
  classification: string | null;
  match_method: MatchMethod;
  match_confidence: number;
  unit_price: number;
  qty_pcs: number;
  extended_price: number;
}

export interface ClientMatch {
  markt: string;
  matched: boolean;
  name: string | null;
  channel: string | null;
  city: string | null;
  match_method: MatchMethod;
}

export interface TotalsCheck {
  net_recomputed: number;
  vat_recomputed: number;
  total_recomputed: number;
  net_stated: number | null;
  vat_stated: number | null;
  total_stated: number | null;
  matches_document: boolean;
  tolerance: number;
}

export interface ValidationResult {
  outcome: 'READY' | 'EXCEPTION';
  client: ClientMatch;
  lines: ValidatedLine[];
  totals: TotalsCheck;
  exceptions: OrderException[];
  summary: string;
  audit: string[];
}

// ---------------------------------------------------------------------------
// Agent activity — what the right-hand rail renders
// ---------------------------------------------------------------------------

export type StepKind = 'MODEL_CALL' | 'TOOL_CALL' | 'DECISION' | 'IO';

export type StepStatus = 'RUNNING' | 'DONE' | 'FAILED';

export interface AgentStep {
  seq: number;
  /** Agent key, matching `AgentProfile.key`. */
  agent: string;
  agent_label: string;
  kind: StepKind;
  status: StepStatus;
  label: string;
  detail: string | null;
  /** Present only on MODEL_CALL steps; `null` marks deterministic Python work. */
  model: string | null;
  model_card: string | null;
  tool: string | null;
  elapsed_ms: number | null;
  started_at: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
}

export type ModelTier = 'flash' | 'pro';

export interface AgentProfile {
  key: string;
  label: string;
  role: string;
  model: string;
  model_card: string;
  model_tier: ModelTier;
  endpoint_location: string;
  tools: string[];
  /** Vertex AI Agent Engine deployment, reported by the backend. */
  runtime: string;
  engine_id: string | null;
  engine_location: string | null;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export type OrderStatus =
  | 'RECEIVED'
  | 'EXTRACTING'
  | 'VALIDATING'
  | 'READY'
  | 'EXCEPTION'
  | 'APPROVED'
  | 'FAILED';

export interface Timings {
  extraction_ms: number | null;
  validation_ms: number | null;
  total_ms: number | null;
}

export interface OrderSummary {
  order_id: string;
  filename: string;
  received_at: string;
  status: OrderStatus;
  order_number: string | null;
  markt: string | null;
  markt_name: string | null;
  currency: string | null;
  total: number | null;
  line_count: number;
  exception_count: number;
  blocking_count: number;
  timings: Timings;
}

/** A human correction, kept by the backend so revalidation can replay it. */
export interface Resolution {
  field: string;
  value: string;
  line_index: number | null;
  at: string;
  by: string;
}

export interface Order {
  order_id: string;
  filename: string;
  received_at: string;
  status: OrderStatus;
  /** UI_UPLOAD or MAILBOX_SYNC (simulated). */
  source: string;
  pdf_bytes: number;
  extracted: ExtractedOrder | null;
  validation: ValidationResult | null;
  steps: AgentStep[];
  resolutions: Resolution[];
  timings: Timings;
  error: string | null;
  approved_payload: Record<string, unknown> | null;
  approved_path: string | null;
  approved_at: string | null;
}

// ---------------------------------------------------------------------------
// Requests / responses
// ---------------------------------------------------------------------------

export interface ResolveRequest {
  field: string;
  value: string;
  line_index?: number | null;
  by?: string;
}

/** Optional approve body; the backend defaults `by` when it is omitted. */
export interface ApproveRequest {
  by?: string;
}

export interface UploadResponse {
  order_id: string;
  filename: string;
  status: OrderStatus;
}

export interface SampleDoc {
  name: string;
  filename: string;
  label: string;
  blurb: string;
  expects: string;
}

export interface MasterDataStats {
  clients: number;
  items: number;
  source: string;
  simulated: boolean;
}

export interface AppConfig {
  app_name: string;
  adk_version: string;
  endpoint_location: string;
  service_region: string;
  project_id: string;
  /** Agents on Agent Engine, API on Cloud Run, documents in a regional bucket. */
  agent_runtime: string;
  agent_engine_location: string;
  api_runtime: string;
  document_bucket: string;
  document_bucket_location: string;
  agents: AgentProfile[];
  masterdata: MasterDataStats;
  residency_note: string;
  simulated_integrations: string[];
}

export interface HealthResponse {
  status: string;
  adk_version: string;
}

export interface ApproveResponse {
  payload: Record<string, unknown>;
  path: string;
}

export type StreamEventType =
  | 'run.started'
  | 'agent.started'
  | 'step'
  | 'extraction.done'
  | 'exception.raised'
  | 'validation.done'
  | 'order.done'
  | 'run.error'
  | 'heartbeat';

export const STREAM_EVENT_TYPES: readonly StreamEventType[] = [
  'run.started',
  'agent.started',
  'step',
  'extraction.done',
  'exception.raised',
  'validation.done',
  'order.done',
  'run.error',
  'heartbeat',
];

export interface StreamEvent {
  type: StreamEventType;
  order_id: string;
  ts: string;
  elapsed_ms: number;
  step: AgentStep | null;
  agent: AgentProfile | null;
  extracted: ExtractedOrder | null;
  validation: ValidationResult | null;
  exception: OrderException | null;
  status: OrderStatus | null;
  message: string | null;
}

// ---------------------------------------------------------------------------
// Master data (seed lists, rendered read-only)
// ---------------------------------------------------------------------------

/** `GET /masterdata/*` wraps the rows with their provenance. */
export interface MasterDataProvenance {
  source: string;
  simulated: boolean;
}

export interface MasterClientsResponse extends MasterDataProvenance {
  clients: MasterClient[];
}

export interface MasterItemsResponse extends MasterDataProvenance {
  items: MasterItem[];
}

export interface MasterClient {
  markt: string;
  name: string;
  legal_entity: string | null;
  channel: string | null;
  city: string | null;
  country: string | null;
  vat_id: string | null;
  eori: string | null;
  active: boolean;
}

export interface MasterItem {
  supplier_item_no: string;
  minos_id: string;
  product_name: string;
  pack: string | null;
  classification: string | null;
  list_price_pln: number | null;
  uom: string | null;
  active: boolean;
}
