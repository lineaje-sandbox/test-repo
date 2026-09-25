/** Display helpers. Every one returns the em dash placeholder rather than a fake zero. */

export const DASH = '—';

export function formatMoney(value: number | null | undefined, currency?: string | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  const amount = value.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${amount} ${currency}` : amount;
}

export function formatQty(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  return Number.isInteger(value) ? `${value}` : value.toFixed(2);
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return DASH;
  return value.toLocaleString('en-GB');
}

export function formatPct(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  return `${value.toFixed(digits)}%`;
}

export function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)} s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatClock(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function msSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Date.now() - date.getTime());
}

const FIELD_LABELS: Record<string, string> = {
  markt: 'Store number (Markt)',
  markt_name: 'Store name',
  order_number: 'Order number',
  order_date: 'Order date',
  delivery_date: 'Delivery date',
  buyer_name: 'Buyer',
  buyer_vat_id: 'Buyer VAT ID',
  buyer_eori: 'Buyer EORI',
  buyer_email: 'Buyer email',
  seller_name: 'Seller',
  seller_vat_id: 'Seller VAT ID',
  supplier_item_no: 'Supplier item number',
  internal_ref: 'Internal reference',
  net_subtotal: 'Net subtotal',
  vat_amount: 'VAT amount',
  vat_rate_pct: 'VAT rate',
  total: 'Total',
  totals: 'Totals',
  currency: 'Currency',
  unit_price: 'Unit price',
  qty_pcs: 'Quantity in pieces',
};

/** Turns a dotted contract path such as `lines.1.supplier_item_no` into prose. */
export function fieldLabel(field: string): string {
  const parts = field.split('.');
  const leaf = parts[parts.length - 1] ?? field;
  const label = FIELD_LABELS[leaf] ?? leaf.replace(/_/g, ' ');
  if (parts[0] === 'lines' && parts.length >= 2) {
    const index = Number(parts[1]);
    if (!Number.isNaN(index)) return `${label} · line ${index + 1}`;
  }
  return label;
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
