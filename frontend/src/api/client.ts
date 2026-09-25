import type {
  AppConfig,
  ApproveResponse,
  HealthResponse,
  MasterClientsResponse,
  MasterItemsResponse,
  Order,
  OrderSummary,
  ResolveRequest,
  SampleDoc,
  UploadResponse,
} from './types';
import {
  mockApprove,
  mockClients,
  mockConfig,
  mockItems,
  mockOrder,
  mockOrders,
  mockResolve,
  mockSamples,
  mockUpload,
} from './mockData';

export const API_BASE = '/api';

/**
 * Opt-in only. The default build talks to the real FastAPI layer; fixtures are
 * reachable solely by running `VITE_USE_MOCK=1 npm run dev`.
 */
export const USE_MOCK = import.meta.env.VITE_USE_MOCK === '1';

/**
 * The signed-in reviewer. `name` is what lands in the audit trail on every
 * resolution and approval, so it is a person rather than a job title: an
 * auditor asking "who changed this store number" needs a name to go to.
 * There is no authentication in this demo, so the reviewer is fixed here.
 */
export const PERSONA = {
  name: 'Anna Nowak',
  role: 'Customer Service Specialist',
  team: 'RC CNE Customer Service',
  initials: 'AN',
} as const;

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
      ...init,
    });
  } catch {
    throw new ApiError(0, 'Backend unreachable — the order processing service is not responding.');
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ApiError(response.status, body || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function postJson<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Resolves after a short beat so mock screens exercise the same loading states. */
function mocked<T>(value: () => T, delayMs = 220): Promise<T> {
  return new Promise((resolve, reject) => {
    window.setTimeout(() => {
      try {
        resolve(value());
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }, delayMs);
  });
}

export const streamUrl = (orderId: string): string =>
  `${API_BASE}/orders/${encodeURIComponent(orderId)}/stream`;

export const pdfUrl = (orderId: string): string =>
  `${API_BASE}/orders/${encodeURIComponent(orderId)}/pdf`;

export const api = {
  health: (): Promise<HealthResponse> =>
    USE_MOCK
      ? mocked(() => ({ status: 'ok', adk_version: mockConfig.adk_version }))
      : request('/health'),

  config: (): Promise<AppConfig> => (USE_MOCK ? mocked(() => mockConfig) : request('/config')),

  samples: (): Promise<SampleDoc[]> => (USE_MOCK ? mocked(() => mockSamples) : request('/samples')),

  orders: (): Promise<OrderSummary[]> => (USE_MOCK ? mocked(() => mockOrders()) : request('/orders')),

  order: (orderId: string): Promise<Order> =>
    USE_MOCK
      ? mocked(() => mockOrder(orderId))
      : request(`/orders/${encodeURIComponent(orderId)}`),

  uploadFile: (file: File): Promise<UploadResponse> => {
    if (USE_MOCK) {
      return mocked(() => {
        const order = mockUpload(file.name);
        return { order_id: order.order_id, filename: order.filename, status: order.status };
      });
    }
    const form = new FormData();
    form.append('file', file);
    // No Content-Type header: the browser must set the multipart boundary itself.
    return request('/orders/upload', { method: 'POST', body: form });
  },

  uploadSample: (name: string): Promise<UploadResponse> => {
    if (USE_MOCK) {
      return mocked(() => {
        const sample = mockSamples.find((item) => item.name === name);
        const order = mockUpload(sample?.filename ?? `${name}.pdf`);
        return { order_id: order.order_id, filename: order.filename, status: order.status };
      });
    }
    return postJson('/orders/upload-sample', { name });
  },

  resolve: (orderId: string, body: ResolveRequest): Promise<Order> =>
    USE_MOCK
      ? mocked(() => mockResolve(orderId, body.field, body.value), 420)
      : postJson(`/orders/${encodeURIComponent(orderId)}/resolve`, { by: PERSONA.name, ...body }),

  approve: (orderId: string): Promise<ApproveResponse> =>
    USE_MOCK
      ? mocked(() => mockApprove(orderId), 420)
      : postJson(`/orders/${encodeURIComponent(orderId)}/approve`, { by: PERSONA.name }),

  masterClients: (): Promise<MasterClientsResponse> =>
    USE_MOCK
      ? mocked(() => ({ source: 'simulated', simulated: true, clients: mockClients }))
      : request('/masterdata/clients'),

  masterItems: (): Promise<MasterItemsResponse> =>
    USE_MOCK
      ? mocked(() => ({ source: 'simulated', simulated: true, items: mockItems }))
      : request('/masterdata/items'),
};
