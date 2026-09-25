/**
 * Development-only fixtures, reached only when VITE_USE_MOCK === '1'.
 *
 * The numbers are lifted verbatim from the real Maxi Care Kalisz purchase order
 * (4604568571) so the happy path reconciles exactly: 42.60 + 365.92 = 408.52 net,
 * 23% VAT = 93.96, total 502.48. Nothing in here is imported by the production
 * path; `client.ts` is the only module that may touch it.
 */
import type {
  AppConfig,
  ExtractedOrder,
  MasterClient,
  MasterItem,
  Order,
  OrderException,
  OrderSummary,
  Resolution,
  SampleDoc,
  StreamEvent,
  ValidationResult,
} from './types';

export const mockConfig: AppConfig = {
  app_name: 'Royal Canin CNE — Autonomous Order Processing',
  adk_version: '1.4.2',
  // Gemini 3.x is global-endpoint only for this project, so inference is not
  // region-pinned even though everything around it sits in europe-west4.
  endpoint_location: 'global',
  service_region: 'europe-west4 (Netherlands)',
  project_id: 'mars-rc-cne-order-ops',
  agent_runtime: 'Vertex AI Agent Engine',
  agent_engine_location: 'europe-west4',
  api_runtime: 'Cloud Run',
  document_bucket: 'mars-rc-cne-order-ops-documents',
  document_bucket_location: 'europe-west4',
  agents: [
    {
      key: 'extraction',
      label: 'Ingestion & Extraction',
      role: 'Reads the purchase order PDF and returns a structured order.',
      model: 'mock-no-llm',
      model_card: 'https://ai.google.dev/gemini-api/docs/models',
      model_tier: 'flash',
      endpoint_location: 'global',
      tools: [],
      runtime: 'Vertex AI Agent Engine',
      engine_id: '4417029183266422784',
      engine_location: 'europe-west4',
    },
    {
      key: 'validation',
      label: 'Validation & Reconciliation',
      role: 'Matches master data, recomputes totals and raises exceptions.',
      model: 'mock-no-llm',
      model_card: 'https://ai.google.dev/gemini-api/docs/models',
      model_tier: 'pro',
      endpoint_location: 'global',
      tools: ['lookup_client', 'lookup_item', 'recompute_totals', 'validate_vat_id'],
      runtime: 'Vertex AI Agent Engine',
      engine_id: '2903118847266422784',
      engine_location: 'europe-west4',
    },
  ],
  masterdata: {
    clients: 9,
    items: 13,
    source: 'simulated',
    simulated: true,
  },
  residency_note:
    'The agents run on Vertex AI Agent Engine in europe-west4 and this API runs on Cloud Run in ' +
    'europe-west4 (Netherlands). Order documents are stored in mars-rc-cne-order-ops-documents ' +
    '(europe-west4). Gemini 3.x is served only from Google\'s global endpoint for this project, ' +
    'so the model call itself is not region-pinned.',
  simulated_integrations: [
    'SharePoint Client List and Item List (local seed files)',
    'SharePoint Bot_Processed output folder (local outbox)',
    'zamowienia@royalcanin.com mailbox sync (not connected)',
    'EU sanctions screening (shape of the check only, no external call)',
  ],
};

export const mockSamples: SampleDoc[] = [
  {
    name: 'happy-path',
    filename: 'EU Compliance Order - Royal Canin.pdf',
    label: 'Maxi Care Kalisz — clean order',
    blurb: 'Two lines, both mapped, totals reconcile to the cent.',
    expects: 'Straight-through processing with no human touch.',
  },
  {
    name: 'unknown-markt',
    filename: 'Royal Canin PO - Markt 3776.pdf',
    label: 'Unknown store number',
    blurb: 'Markt 3776 is absent from the client list.',
    expects: 'A blocking exception with a fuzzy store suggestion.',
  },
  {
    name: 'unmapped-item',
    filename: 'Royal Canin PO - new SKU.pdf',
    label: 'Unmapped supplier item',
    blurb: 'A supplier item number with no Minos mapping yet.',
    expects: 'A blocking exception on the offending line only.',
  },
];

const HAPPY_EXTRACTED: ExtractedOrder = {
  order_number: '4604568571',
  order_date: '01.03.2026',
  delivery_date: '02.03.2026',
  markt: '3729',
  markt_name: 'Maxi Care Kalisz',
  buyer_name: 'Alpha Pet Retailers Sp. z o.o.',
  buyer_vat_id: 'PL7010158031',
  buyer_eori: 'PL701015803100000',
  buyer_email: 'zakupy@alphapet.pl',
  seller_name: 'Royal Canin Dystrybucja Sp. z o.o.',
  seller_vat_id: 'PL5252488101',
  currency: 'PLN',
  net_subtotal: 408.52,
  vat_rate_pct: 23,
  vat_amount: 93.96,
  total: 502.48,
  compliance_standard: 'ISO-22000 (Food Safety)',
  sanctions_screening: 'CLEAR (EU-LIST-2026)',
  lines: [
    {
      supplier_item_no: '3579009420',
      internal_ref: '1311655',
      description: 'RC CCN Coat Care 85g',
      unit_price: 3.55,
      ord_qty: 1,
      qty_pcs: 12,
      uom: 'ST',
    },
    {
      supplier_item_no: '313270',
      internal_ref: '1003120012',
      description: 'RC INTENSE HAIRBALL 2KG',
      unit_price: 91.48,
      ord_qty: 4,
      qty_pcs: 4,
      uom: 'ST',
    },
  ],
};

const HAPPY_VALIDATION: ValidationResult = {
  outcome: 'READY',
  client: {
    markt: '3729',
    matched: true,
    name: 'Maxi Care Kalisz',
    channel: 'PSR',
    city: 'Kalisz',
    match_method: 'EXACT',
  },
  lines: [
    {
      line_index: 0,
      supplier_item_no: '3579009420',
      description: 'RC CCN Coat Care 85g',
      minos_id: '1311655',
      product_name: 'RC CCN Coat Care 85g',
      classification: 'PSR',
      match_method: 'EXACT',
      match_confidence: 1,
      unit_price: 3.55,
      qty_pcs: 12,
      extended_price: 42.6,
    },
    {
      line_index: 1,
      supplier_item_no: '313270',
      description: 'RC INTENSE HAIRBALL 2KG',
      minos_id: '1003120012',
      product_name: 'RC Intense Hairball 2kg',
      classification: 'PSR',
      match_method: 'EXACT',
      match_confidence: 1,
      unit_price: 91.48,
      qty_pcs: 4,
      extended_price: 365.92,
    },
  ],
  totals: {
    net_recomputed: 408.52,
    vat_recomputed: 93.96,
    total_recomputed: 502.48,
    net_stated: 408.52,
    vat_stated: 93.96,
    total_stated: 502.48,
    matches_document: true,
    tolerance: 0.01,
  },
  exceptions: [],
  summary:
    'Both lines mapped to Minos on an exact match and the recomputed totals agree with the document to the cent. No human action required.',
  audit: [
    'Client list lookup: Markt 3729 matched EXACT.',
    'Item list lookup: 2 of 2 supplier item numbers mapped EXACT.',
    'Totals recomputed in Python: net 408.52, VAT 93.96 at 23%, total 502.48.',
    'VAT ID PL7010158031 passed the PL checksum test.',
    'Sanctions screening returned CLEAR against EU-LIST-2026.',
  ],
};

const MARKT_EXCEPTION: OrderException = {
  kind: 'UNKNOWN_MARKT',
  severity: 'BLOCKING',
  field: 'markt',
  line_index: null,
  message:
    'Store number 3776 is not in the client list, so the order cannot be routed to a delivery location.',
  observed: '3776',
  expected: 'A Markt present in the SharePoint client list',
  suggestion: '3741',
  suggestion_label: 'Maxi Care Wroclaw Krzyki (3741)',
  suggestion_confidence: 0.82,
  auto_resolvable: false,
  resolved: false,
  resolved_value: null,
  resolved_by: null,
};

const ITEM_EXCEPTION: OrderException = {
  kind: 'UNMAPPED_ITEM',
  severity: 'BLOCKING',
  field: 'lines.1.supplier_item_no',
  line_index: 1,
  message:
    'Supplier item 313999 has no Minos mapping, so this line cannot be priced or fulfilled.',
  observed: '313999',
  expected: 'A supplier item number present in the item list',
  suggestion: '313271',
  suggestion_label: 'RC Intense Hairball 4kg — Minos 1003120019',
  suggestion_confidence: 0.74,
  auto_resolvable: true,
  resolved: false,
  resolved_by: null,
  resolved_value: null,
};

function stepsFor(orderId: string): Order['steps'] {
  const flash = 'gemini-3.8-flash';
  const pro = 'gemini-3.1-pro-preview';
  const card = 'https://ai.google.dev/gemini-api/docs/models';
  const exception = orderId.endsWith('-exc');
  return [
    {
      seq: 1,
      agent: 'extraction',
      agent_label: 'Ingestion & Extraction',
      kind: 'IO',
      status: 'DONE',
      label: 'Fetch document',
      detail: '171 KB PDF, 1 page, uploaded through the UI',
      model: null,
      model_card: null,
      tool: null,
      elapsed_ms: 62,
      started_at: null,
      tokens_in: null,
      tokens_out: null,
    },
    {
      seq: 2,
      agent: 'extraction',
      agent_label: 'Ingestion & Extraction',
      kind: 'MODEL_CALL',
      status: 'DONE',
      label: 'Read the purchase order',
      detail: 'Multimodal pass over the page image and text layer',
      model: flash,
      model_card: card,
      tool: null,
      elapsed_ms: 1840,
      started_at: null,
      tokens_in: 4821,
      tokens_out: 118,
    },
    {
      seq: 3,
      agent: 'extraction',
      agent_label: 'Ingestion & Extraction',
      kind: 'MODEL_CALL',
      status: 'DONE',
      label: 'Extract header and party fields',
      detail: 'Order 4604568571 · Markt 3729 · delivery 02.03.2026',
      model: flash,
      model_card: card,
      tool: null,
      elapsed_ms: 1120,
      started_at: null,
      tokens_in: 1904,
      tokens_out: 242,
    },
    {
      seq: 4,
      agent: 'extraction',
      agent_label: 'Ingestion & Extraction',
      kind: 'MODEL_CALL',
      status: 'DONE',
      label: 'Extract 2 order lines',
      detail: 'LIEF. ART. NR., description, ORD QTY and QUANTITY IN PCS per row',
      model: flash,
      model_card: card,
      tool: null,
      elapsed_ms: 1465,
      started_at: null,
      tokens_in: 2140,
      tokens_out: 388,
    },
    {
      seq: 5,
      agent: 'extraction',
      agent_label: 'Ingestion & Extraction',
      kind: 'DECISION',
      status: 'DONE',
      label: 'Emit structured order',
      detail: 'Schema validated, handing off to reconciliation',
      model: null,
      model_card: null,
      tool: null,
      elapsed_ms: 18,
      started_at: null,
      tokens_in: null,
      tokens_out: null,
    },
    {
      seq: 6,
      agent: 'validation',
      agent_label: 'Validation & Reconciliation',
      kind: 'TOOL_CALL',
      status: 'DONE',
      label: exception ? 'Look up Markt 3776' : 'Look up Markt 3729',
      detail: exception ? 'No row in the client list' : 'Maxi Care Kalisz · PSR · Kalisz',
      model: null,
      model_card: null,
      tool: 'lookup_client',
      elapsed_ms: 12,
      started_at: null,
      tokens_in: null,
      tokens_out: null,
    },
    {
      seq: 7,
      agent: 'validation',
      agent_label: 'Validation & Reconciliation',
      kind: 'TOOL_CALL',
      status: 'DONE',
      label: 'Resolve supplier item 3579009420',
      detail: 'Minos 1311655 · PSR · EXACT',
      model: null,
      model_card: null,
      tool: 'lookup_item',
      elapsed_ms: 9,
      started_at: null,
      tokens_in: null,
      tokens_out: null,
    },
    {
      seq: 8,
      agent: 'validation',
      agent_label: 'Validation & Reconciliation',
      kind: 'TOOL_CALL',
      status: exception ? 'FAILED' : 'DONE',
      label: exception ? 'Resolve supplier item 313999' : 'Resolve supplier item 313270',
      detail: exception ? 'No mapping found in the item list' : 'Minos 1003120012 · PSR · EXACT',
      model: null,
      model_card: null,
      tool: 'lookup_item',
      elapsed_ms: 11,
      started_at: null,
      tokens_in: null,
      tokens_out: null,
    },
    {
      seq: 9,
      agent: 'validation',
      agent_label: 'Validation & Reconciliation',
      kind: 'TOOL_CALL',
      status: 'DONE',
      label: 'Recompute net, VAT and total',
      detail: 'net 408.52 · VAT 93.96 at 23% · total 502.48',
      model: null,
      model_card: null,
      tool: 'recompute_totals',
      elapsed_ms: 4,
      started_at: null,
      tokens_in: null,
      tokens_out: null,
    },
    {
      seq: 10,
      agent: 'validation',
      agent_label: 'Validation & Reconciliation',
      kind: 'TOOL_CALL',
      status: 'DONE',
      label: 'Validate VAT ID PL7010158031',
      detail: 'PL checksum passed',
      model: null,
      model_card: null,
      tool: 'validate_vat_id',
      elapsed_ms: 3,
      started_at: null,
      tokens_in: null,
      tokens_out: null,
    },
    {
      seq: 11,
      agent: 'validation',
      agent_label: 'Validation & Reconciliation',
      kind: 'MODEL_CALL',
      status: 'DONE',
      label: 'Adjudicate the reconciliation',
      detail: exception
        ? 'Raised 2 blocking exceptions with candidate suggestions'
        : 'All checks clean, order released',
      model: pro,
      model_card: card,
      tool: null,
      elapsed_ms: 2380,
      started_at: null,
      tokens_in: 3412,
      tokens_out: exception ? 512 : 196,
    },
    {
      seq: 12,
      agent: 'validation',
      agent_label: 'Validation & Reconciliation',
      kind: 'DECISION',
      status: 'DONE',
      label: exception ? 'Route to the exception queue' : 'Release order as READY',
      detail: exception
        ? '2 items need a customer service specialist'
        : 'Payload staged for Bot_Processed',
      model: null,
      model_card: null,
      tool: null,
      elapsed_ms: 15,
      started_at: null,
      tokens_in: null,
      tokens_out: null,
    },
  ];
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function buildHappyOrder(): Order {
  return {
    order_id: 'mock-4604568571',
    filename: 'EU Compliance Order - Royal Canin.pdf',
    received_at: minutesAgo(18),
    status: 'READY',
    source: 'UI_UPLOAD',
    pdf_bytes: 171_039,
    extracted: HAPPY_EXTRACTED,
    validation: HAPPY_VALIDATION,
    steps: stepsFor('mock-4604568571'),
    resolutions: [],
    timings: { extraction_ms: 4505, validation_ms: 2434, total_ms: 6939 },
    error: null,
    approved_payload: null,
    approved_path: null,
    approved_at: null,
  };
}

function buildExceptionOrder(): Order {
  const extracted: ExtractedOrder = {
    ...HAPPY_EXTRACTED,
    order_number: '4604568602',
    markt: '3776',
    markt_name: null,
    lines: [
      HAPPY_EXTRACTED.lines[0] ?? {
        supplier_item_no: '3579009420',
        internal_ref: '1311655',
        description: 'RC CCN Coat Care 85g',
        unit_price: 3.55,
        ord_qty: 1,
        qty_pcs: 12,
        uom: 'ST',
      },
      {
        supplier_item_no: '313999',
        internal_ref: null,
        description: 'RC INTENSE HAIRBALL 4KG',
        unit_price: 168.9,
        ord_qty: 2,
        qty_pcs: 2,
        uom: 'ST',
      },
    ],
    net_subtotal: 380.4,
    vat_amount: 87.49,
    total: 467.89,
  };

  return {
    order_id: 'mock-4604568602-exc',
    filename: 'Royal Canin PO - Markt 3776.pdf',
    received_at: minutesAgo(6),
    status: 'EXCEPTION',
    source: 'MAILBOX_SYNC',
    pdf_bytes: 164_220,
    extracted,
    validation: {
      outcome: 'EXCEPTION',
      client: {
        markt: '3776',
        matched: false,
        name: null,
        channel: null,
        city: null,
        match_method: 'NONE',
      },
      lines: [
        {
          line_index: 0,
          supplier_item_no: '3579009420',
          description: 'RC CCN Coat Care 85g',
          minos_id: '1311655',
          product_name: 'RC CCN Coat Care 85g',
          classification: 'PSR',
          match_method: 'EXACT',
          match_confidence: 1,
          unit_price: 3.55,
          qty_pcs: 12,
          extended_price: 42.6,
        },
        {
          line_index: 1,
          supplier_item_no: '313999',
          description: 'RC INTENSE HAIRBALL 4KG',
          minos_id: null,
          product_name: null,
          classification: null,
          match_method: 'NONE',
          match_confidence: 0,
          unit_price: 168.9,
          qty_pcs: 2,
          extended_price: 337.8,
        },
      ],
      totals: {
        net_recomputed: 380.4,
        vat_recomputed: 87.49,
        total_recomputed: 467.89,
        net_stated: 380.4,
        vat_stated: 87.49,
        total_stated: 467.89,
        matches_document: true,
        tolerance: 0.01,
      },
      exceptions: [MARKT_EXCEPTION, ITEM_EXCEPTION],
      summary:
        'The store number is unknown and one line has no Minos mapping. Totals reconcile, so only the two flagged fields need a decision.',
      audit: [
        'Client list lookup: Markt 3776 returned no row.',
        'Item list lookup: 1 of 2 supplier item numbers mapped EXACT.',
        'Totals recomputed in Python: net 380.40, VAT 87.49 at 23%, total 467.89.',
      ],
    },
    steps: stepsFor('mock-4604568602-exc'),
    resolutions: [],
    timings: { extraction_ms: 4505, validation_ms: 2434, total_ms: 6939 },
    error: null,
    approved_payload: null,
    approved_path: null,
    approved_at: null,
  };
}

/** Mutable session store so upload, resolve and approve behave like the real API. */
const store = new Map<string, Order>();
let counter = 0;

function ensureSeeded(): void {
  if (store.size > 0) return;
  const happy = buildHappyOrder();
  const exc = buildExceptionOrder();
  store.set(happy.order_id, happy);
  store.set(exc.order_id, exc);
}

export function mockOrders(): OrderSummary[] {
  ensureSeeded();
  return [...store.values()]
    .sort((a, b) => b.received_at.localeCompare(a.received_at))
    .map(toSummary);
}

function toSummary(order: Order): OrderSummary {
  const unresolved = order.validation?.exceptions.filter((item) => !item.resolved) ?? [];
  return {
    order_id: order.order_id,
    filename: order.filename,
    received_at: order.received_at,
    status: order.status,
    order_number: order.extracted?.order_number ?? null,
    markt: order.extracted?.markt ?? null,
    markt_name: order.validation?.client.name ?? order.extracted?.markt_name ?? null,
    currency: order.extracted?.currency ?? null,
    total: order.validation?.totals.total_recomputed ?? order.extracted?.total ?? null,
    line_count: order.validation?.lines.length ?? order.extracted?.lines.length ?? 0,
    exception_count: unresolved.length,
    blocking_count: unresolved.filter((item) => item.severity === 'BLOCKING').length,
    timings: order.timings,
  };
}

export function mockOrder(orderId: string): Order {
  ensureSeeded();
  const order = store.get(orderId);
  if (order === undefined) {
    throw new Error(`Mock order ${orderId} not found`);
  }
  return order;
}

export function mockUpload(filename: string): Order {
  ensureSeeded();
  counter += 1;
  const withException = counter % 2 === 0;
  const base = withException ? buildExceptionOrder() : buildHappyOrder();
  const order: Order = {
    ...base,
    order_id: `mock-run-${counter}${withException ? '-exc' : ''}`,
    filename,
    received_at: new Date().toISOString(),
    status: 'RECEIVED',
    source: 'UI_UPLOAD',
    extracted: null,
    validation: null,
    steps: [],
    resolutions: [],
    timings: { extraction_ms: null, validation_ms: null, total_ms: null },
  };
  store.set(order.order_id, order);
  return order;
}

/** Drives the mock SSE replay: the same frames the backend would emit, in order. */
export function mockStream(orderId: string): StreamEvent[] {
  ensureSeeded();
  const pending = store.get(orderId);
  if (pending === undefined) return [];
  const isException = orderId.endsWith('-exc');
  const finished = isException ? buildExceptionOrder() : buildHappyOrder();
  const steps = stepsFor(orderId);
  const now = new Date().toISOString();
  let elapsed = 0;

  const frames: StreamEvent[] = [];
  const push = (partial: Partial<StreamEvent> & Pick<StreamEvent, 'type'>): void => {
    frames.push({
      order_id: orderId,
      ts: now,
      elapsed_ms: elapsed,
      step: null,
      agent: null,
      extracted: null,
      validation: null,
      exception: null,
      status: null,
      message: null,
      ...partial,
    });
  };

  push({ type: 'run.started', status: 'EXTRACTING' });
  for (const agent of mockConfig.agents) {
    const agentSteps = steps.filter((step) => step.agent === agent.key);
    push({ type: 'agent.started', agent, status: agent.key === 'extraction' ? 'EXTRACTING' : 'VALIDATING' });
    for (const step of agentSteps) {
      elapsed += step.elapsed_ms ?? 10;
      push({ type: 'step', step, elapsed_ms: elapsed });
    }
    if (agent.key === 'extraction') {
      push({ type: 'extraction.done', extracted: finished.extracted, status: 'VALIDATING' });
    } else {
      for (const item of finished.validation?.exceptions ?? []) {
        push({ type: 'exception.raised', exception: item });
      }
      push({ type: 'validation.done', validation: finished.validation, status: finished.status });
    }
  }
  push({ type: 'order.done', status: finished.status });

  // Commit the finished shape so a later GET /orders/{id} agrees with the stream.
  store.set(orderId, {
    ...pending,
    status: finished.status,
    extracted: finished.extracted,
    validation: finished.validation,
    steps,
    timings: finished.timings,
  });

  return frames;
}

export function mockResolve(orderId: string, field: string, value: string): Order {
  const order = mockOrder(orderId);
  const validation = order.validation;
  if (validation === null) return order;
  const exceptions = validation.exceptions.map((item) =>
    item.field === field && !item.resolved
      ? { ...item, resolved: true, resolved_value: value, resolved_by: 'Customer Service Specialist' }
      : item,
  );
  const lines = validation.lines.map((line) =>
    field === `lines.${line.line_index}.supplier_item_no`
      ? {
          ...line,
          supplier_item_no: value,
          minos_id: '1003120019',
          product_name: 'RC Intense Hairball 4kg',
          classification: 'PSR',
          match_method: 'HUMAN' as const,
          match_confidence: 1,
        }
      : line,
  );
  const stillOpen = exceptions.some((item) => !item.resolved);
  const resolution: Resolution = {
    field,
    value,
    line_index: validation.exceptions.find((item) => item.field === field)?.line_index ?? null,
    at: new Date().toISOString(),
    by: 'Customer Service Specialist',
  };
  const next: Order = {
    ...order,
    status: stillOpen ? 'EXCEPTION' : 'READY',
    resolutions: [...order.resolutions, resolution],
    extracted:
      order.extracted !== null && field === 'markt'
        ? { ...order.extracted, markt: value, markt_name: 'Maxi Care Wroclaw Krzyki' }
        : order.extracted,
    validation: {
      ...validation,
      outcome: stillOpen ? 'EXCEPTION' : 'READY',
      exceptions,
      lines,
      client:
        field === 'markt'
          ? {
              markt: value,
              matched: true,
              name: 'Maxi Care Wroclaw Krzyki',
              channel: 'PSR',
              city: 'Wroclaw',
              match_method: 'HUMAN',
            }
          : validation.client,
    },
  };
  store.set(orderId, next);
  return next;
}

export function mockApprove(orderId: string): { payload: Record<string, unknown>; path: string } {
  const order = mockOrder(orderId);
  store.set(orderId, { ...order, status: 'APPROVED', approved_at: new Date().toISOString() });
  return {
    payload: {
      order_number: order.extracted?.order_number ?? null,
      markt: order.extracted?.markt ?? null,
      currency: order.extracted?.currency ?? 'PLN',
      total: order.validation?.totals.total_recomputed ?? null,
      lines: order.validation?.lines ?? [],
    },
    path: `SharePoint / Bot_Processed / ${order.extracted?.order_number ?? order.order_id}.json (simulated)`,
  };
}

export const mockClients: MasterClient[] = [
  {
    markt: '3729',
    name: 'Maxi Care Kalisz',
    legal_entity: 'Alpha Pet Retailers Sp. z o.o.',
    channel: 'PSR',
    city: 'Kalisz',
    country: 'PL',
    vat_id: 'PL7010158031',
    eori: 'PL701015803100000',
    active: true,
  },
  {
    markt: '3741',
    name: 'Maxi Care Wroclaw Krzyki',
    legal_entity: 'Alpha Pet Retailers Sp. z o.o.',
    channel: 'PSR',
    city: 'Wroclaw',
    country: 'PL',
    vat_id: 'PL7010158031',
    eori: 'PL701015803100000',
    active: true,
  },
];

export const mockItems: MasterItem[] = [
  {
    supplier_item_no: '3579009420',
    minos_id: '1311655',
    product_name: 'RC CCN Coat Care 85g',
    pack: '12 x 85 g pouch',
    classification: 'PSR',
    list_price_pln: 3.55,
    uom: 'ST',
    active: true,
  },
  {
    supplier_item_no: '313270',
    minos_id: '1003120012',
    product_name: 'RC Intense Hairball 2kg',
    pack: '1 x 2 kg bag',
    classification: 'PSR',
    list_price_pln: 91.48,
    uom: 'ST',
    active: true,
  },
];
