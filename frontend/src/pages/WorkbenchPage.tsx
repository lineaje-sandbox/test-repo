import { useMemo, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  LinearProgress,
  Paper,
  Skeleton,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import AssignmentTurnedInOutlinedIcon from '@mui/icons-material/AssignmentTurnedInOutlined';
import BusinessOutlinedIcon from '@mui/icons-material/BusinessOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import HistoryIcon from '@mui/icons-material/HistoryRounded';
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import { api, pdfUrl } from '../api/client';
import type { OrderException, OrderStatus } from '../api/types';
import type { OrderStreamResult } from '../api/useOrderStream';
import { marsTokens, monoStack } from '../theme/marsTheme';
import { breakAnywhere, stackGrid } from '../theme/layout';
import { DASH, fieldLabel, formatDateTime, formatMs, formatPct } from '../utils/format';
import { ExceptionCard } from '../components/ExceptionCard';
import { ExtractedFieldCard, type ExtractedField } from '../components/ExtractedFieldCard';
import { LineItemTable } from '../components/LineItemTable';
import { StatusPill } from '../components/StatusPill';
import { TotalsCard } from '../components/TotalsCard';

const IN_FLIGHT: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'RECEIVED',
  'EXTRACTING',
  'VALIDATING',
]);

interface WorkbenchPageProps {
  stream: OrderStreamResult;
  onOrdersChanged: () => void;
}

export function WorkbenchPage({ stream, onOrdersChanged }: WorkbenchPageProps) {
  const { id } = useParams<{ id: string }>();
  const { order, loading, runState } = stream;
  const [busyField, setBusyField] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approvedPath, setApprovedPath] = useState<string | null>(null);

  const extracted = order?.extracted ?? null;
  const validation = order?.validation ?? null;
  const inFlight = order !== null && IN_FLIGHT.has(order.status);
  const pending = inFlight || runState === 'running' || runState === 'connecting';

  const exceptions = validation?.exceptions ?? [];
  const openExceptions = exceptions.filter((item) => !item.resolved);

  const orderFields = useMemo<ExtractedField[]>(
    () => [
      { key: 'order_number', label: 'Order number', value: extracted?.order_number ?? null, mono: true },
      { key: 'order_date', label: 'Order date', value: extracted?.order_date ?? null, mono: true },
      { key: 'currency', label: 'Currency', value: extracted?.currency ?? null, mono: true },
      {
        key: 'compliance_standard',
        label: 'Compliance standard',
        value: extracted?.compliance_standard ?? null,
      },
      {
        key: 'sanctions_screening',
        label: 'Sanctions screening',
        value: extracted?.sanctions_screening ?? null,
      },
    ],
    [extracted],
  );

  const deliveryFields = useMemo<ExtractedField[]>(
    () => [
      { key: 'markt', label: 'Store number (Markt)', value: extracted?.markt ?? null, mono: true },
      {
        key: 'markt_name',
        label: 'Store name',
        value: validation?.client.name ?? extracted?.markt_name ?? null,
      },
      {
        key: 'delivery_date',
        label: 'Delivery date',
        value: extracted?.delivery_date ?? null,
        mono: true,
      },
      {
        key: 'client_channel',
        label: 'Channel · city',
        value:
          validation === null
            ? null
            : [validation.client.channel, validation.client.city].filter(Boolean).join(' · ') || null,
      },
    ],
    [extracted, validation],
  );

  const partyFields = useMemo<ExtractedField[]>(
    () => [
      { key: 'buyer_name', label: 'Buyer', value: extracted?.buyer_name ?? null, wide: true },
      { key: 'buyer_vat_id', label: 'Buyer VAT ID', value: extracted?.buyer_vat_id ?? null, mono: true },
      { key: 'buyer_eori', label: 'Buyer EORI', value: extracted?.buyer_eori ?? null, mono: true },
      { key: 'buyer_email', label: 'Buyer email', value: extracted?.buyer_email ?? null, mono: true },
      { key: 'seller_name', label: 'Seller', value: extracted?.seller_name ?? null, wide: true },
      { key: 'seller_vat_id', label: 'Seller VAT ID', value: extracted?.seller_vat_id ?? null, mono: true },
    ],
    [extracted],
  );

  // Anything not claimed by a field card, the line table or the totals card still
  // has to be actionable, so it surfaces in a panel above the cards.
  const claimedFields = useMemo(() => {
    const keys = new Set<string>();
    for (const field of [...orderFields, ...deliveryFields, ...partyFields]) keys.add(field.key);
    return keys;
  }, [orderFields, deliveryFields, partyFields]);

  const orphanExceptions = openExceptions.filter(
    (item) =>
      item.line_index === null &&
      !claimedFields.has(item.field) &&
      item.kind !== 'TOTALS_MISMATCH' &&
      !item.field.startsWith('totals'),
  );

  const handleResolve = async (exception: OrderException, value: string): Promise<void> => {
    if (order === null || value.length === 0) return;
    setBusyField(exception.field);
    setActionError(null);
    try {
      const next = await api.resolve(order.order_id, {
        field: exception.field,
        value,
        line_index: exception.line_index,
      });
      stream.applyOrder(next);
      onOrdersChanged();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not apply the change.');
    } finally {
      setBusyField(null);
    }
  };

  const handleApprove = async (): Promise<void> => {
    if (order === null) return;
    setApproving(true);
    setActionError(null);
    try {
      const response = await api.approve(order.order_id);
      setApprovedPath(response.path);
      await stream.refresh();
      onOrdersChanged();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not approve the order.');
    } finally {
      setApproving(false);
    }
  };

  if (order === null) {
    return (
      <Box sx={{ ...stackGrid, gap: 2 }}>
        <Button
          component={RouterLink}
          to="/"
          startIcon={<ArrowBackRoundedIcon sx={{ fontSize: 18 }} />}
          sx={{ justifySelf: 'start', color: 'text.secondary', px: 0 }}
        >
          Back to dashboard
        </Button>
        {loading ? (
          <Paper sx={{ borderRadius: 3, p: 3 }}>
            <Skeleton width="42%" height={30} />
            <Skeleton width="68%" height={18} />
            <Skeleton height={320} sx={{ mt: 2 }} />
          </Paper>
        ) : (
          <Alert severity="error">
            {stream.error ?? `Order ${id ?? ''} could not be loaded from the service.`}
          </Alert>
        )}
      </Box>
    );
  }

  const canApprove = order.status === 'READY' && openExceptions.length === 0;

  return (
    <Box sx={{ ...stackGrid, gap: 2.5 }}>
      <Box sx={{ ...stackGrid, gap: 1.5 }}>
        <Button
          component={RouterLink}
          to="/"
          startIcon={<ArrowBackRoundedIcon sx={{ fontSize: 18 }} />}
          sx={{ justifySelf: 'start', color: 'text.secondary', px: 0 }}
        >
          Back to dashboard
        </Button>

        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 2,
            flexWrap: 'wrap',
            minWidth: 0,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" sx={{ color: 'text.secondary', mb: 0.5 }}>
              Order workbench
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', minWidth: 0 }}>
              <Typography variant="h2" sx={{ fontFamily: 'var(--font-mono)', ...breakAnywhere }}>
                {extracted?.order_number ?? order.filename}
              </Typography>
              <StatusPill status={order.status} />
            </Box>
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.75, ...breakAnywhere }}>
              {order.filename} · received {formatDateTime(order.received_at)} · source {order.source}
              {order.timings.total_ms !== null ? ` · ${formatMs(order.timings.total_ms)} end to end` : ''}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0 }}>
            <Tooltip
              title={
                canApprove
                  ? 'Write the validated payload to the processed folder'
                  : order.status === 'APPROVED'
                    ? 'This order has already been approved'
                    : 'Resolve the open exceptions first'
              }
            >
              <span>
                <Button
                  variant="contained"
                  disabled={!canApprove || approving}
                  onClick={() => void handleApprove()}
                  startIcon={
                    approving ? (
                      <CircularProgress size={15} color="inherit" />
                    ) : (
                      <AssignmentTurnedInOutlinedIcon sx={{ fontSize: 18 }} />
                    )
                  }
                >
                  {order.status === 'APPROVED' ? 'Approved' : 'Approve order'}
                </Button>
              </span>
            </Tooltip>
          </Box>
        </Box>
      </Box>

      {actionError !== null && (
        <Alert severity="error" onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      {(approvedPath !== null || order.approved_path !== null) && (
        <Alert severity="success" icon={<AssignmentTurnedInOutlinedIcon />}>
          Payload written to{' '}
          <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 700, ...breakAnywhere }}>
            {approvedPath ?? order.approved_path}
          </Box>
        </Alert>
      )}

      {order.error !== null && <Alert severity="error">{order.error}</Alert>}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(0, 1fr)' },
          gap: 2.5,
          alignItems: 'start',
        }}
      >
        {/* Left: the original document, sticky on wide screens so it stays in view. */}
        <Box
          sx={{
            minWidth: 0,
            position: { xs: 'static', md: 'sticky' },
            top: 'calc(var(--appbar-height) + 16px)',
          }}
        >
          <Paper sx={{ borderRadius: 2.5, overflow: 'hidden', minWidth: 0, ...stackGrid }}>
            <Box
              sx={{
                px: 2,
                py: 1.5,
                borderBottom: '1px solid rgba(0,0,32,0.07)',
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                minWidth: 0,
              }}
            >
              <PictureAsPdfOutlinedIcon
                sx={{ fontSize: 17, color: marsTokens.marsPetcareRed, flexShrink: 0 }}
              />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, ...breakAnywhere }}>
                  {order.filename}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', ...breakAnywhere }}>
                  Received {formatDateTime(order.received_at)} · {order.source}
                  {order.pdf_bytes > 0 ? ` · ${Math.round(order.pdf_bytes / 1024)} KB` : ''}
                </Typography>
              </Box>
              <Button
                size="small"
                variant="outlined"
                component="a"
                href={pdfUrl(order.order_id)}
                target="_blank"
                rel="noreferrer noopener"
                sx={{ flexShrink: 0 }}
              >
                Open
              </Button>
            </Box>
            <Box
              sx={{
                height: { xs: 460, md: 'calc(100vh - 260px)' },
                minHeight: 420,
                bgcolor: '#2A2A34',
                minWidth: 0,
              }}
            >
              {/*
                navpanes=0 matters: at this pane width Chrome's viewer opens its
                thumbnail sidebar, which pushes the page across and clips it
                horizontally, leaving the document unreadable beside the
                extracted values it is meant to be checked against. The toolbar
                is kept so the zoom controls stay available.
              */}
              <embed
                src={`${pdfUrl(order.order_id)}#navpanes=0`}
                type="application/pdf"
                title={`Original document for ${order.filename}`}
                style={{ width: '100%', height: '100%', display: 'block', border: 0 }}
              />
            </Box>
          </Paper>
        </Box>

        {/* Right: the extracted and reconciled view. */}
        <Box sx={{ ...stackGrid, gap: 2, minWidth: 0 }}>
          <Paper sx={{ borderRadius: 2.5, minWidth: 0, ...stackGrid, overflow: 'hidden' }}>
            <Box
              sx={{
                px: 2,
                py: 1.5,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                minWidth: 0,
              }}
            >
              <FactCheckOutlinedIcon sx={{ fontSize: 17, color: marsTokens.marsBlue, flexShrink: 0 }} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontSize: '0.875rem', fontWeight: 800 }}>
                  {pending
                    ? runState === 'connecting'
                      ? 'Connecting to the agent run…'
                      : order.status === 'VALIDATING'
                        ? 'Reconciling against master data…'
                        : 'Reading the document…'
                    : validation?.summary !== undefined
                      ? 'Reconciliation summary'
                      : 'Extracted fields'}
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25, ...breakAnywhere }}>
                  {pending
                    ? 'Fields fill in as the agents report — nothing here blocks on a full page load.'
                    : (validation?.summary ??
                      'Awaiting the reconciliation agent. Extracted values are shown as they arrive.')}
                </Typography>
              </Box>
            </Box>
            {/* A slim indeterminate bar in the panel header, never a full-screen spinner. */}
            {pending && <LinearProgress sx={{ height: 3, borderRadius: 0 }} />}
            {validation !== null && validation.audit.length > 0 && !pending && (
              <Box sx={{ px: 2, pb: 1.75, pt: 0.5, ...stackGrid, gap: 0.5 }}>
                {validation.audit.map((line) => (
                  <Box key={line} sx={{ display: 'flex', gap: 0.875, minWidth: 0 }}>
                    <Box
                      sx={{
                        mt: 0.75,
                        width: 4,
                        height: 4,
                        borderRadius: '50%',
                        bgcolor: marsTokens.marsGreen,
                        flexShrink: 0,
                      }}
                    />
                    <Typography variant="caption" sx={{ color: 'text.secondary', ...breakAnywhere }}>
                      {line}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Paper>

          {order.resolutions.length > 0 && (
            <Paper sx={{ p: 2, ...stackGrid, gap: 1.25 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                <HistoryIcon sx={{ fontSize: 18, color: marsTokens.marsBlue, flexShrink: 0 }} />
                <Typography variant="overline" sx={{ color: 'text.secondary' }}>
                  Human corrections on file
                </Typography>
              </Box>
              <Typography variant="caption" sx={{ color: 'text.secondary', ...breakAnywhere }}>
                The backend keeps every correction so a re-run replays it instead of asking again.
              </Typography>
              <Box sx={{ ...stackGrid, gap: 1 }}>
                {order.resolutions.map((resolution, index) => (
                  <Box
                    key={`${resolution.field}-${resolution.at}-${index}`}
                    sx={{
                      ...stackGrid,
                      gap: 0.25,
                      pl: 1.25,
                      borderLeft: `2px solid ${marsTokens.marsGreen}`,
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 600, ...breakAnywhere }}>
                      {fieldLabel(resolution.field)}
                      {resolution.line_index !== null && ` · line ${resolution.line_index + 1}`}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{ fontFamily: monoStack, color: marsTokens.marsBlue, ...breakAnywhere }}
                    >
                      {resolution.value}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.disabled', ...breakAnywhere }}>
                      {resolution.by} · {formatDateTime(resolution.at)}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Paper>
          )}

          {orphanExceptions.length > 0 && (
            <Box sx={{ ...stackGrid, gap: 1.25 }}>
              {orphanExceptions.map((exception) => (
                <ExceptionCard
                  key={`${exception.kind}-${exception.field}`}
                  exception={exception}
                  onResolve={handleResolve}
                  busy={busyField === exception.field}
                  variant="queue"
                />
              ))}
            </Box>
          )}

          <ExtractedFieldCard
            title="Order"
            icon={ReceiptLongOutlinedIcon}
            fields={orderFields}
            exceptions={exceptions}
            pending={pending}
            onResolve={handleResolve}
            busyField={busyField}
          />

          <ExtractedFieldCard
            title="Delivery"
            icon={LocalShippingOutlinedIcon}
            fields={deliveryFields}
            exceptions={exceptions}
            pending={pending}
            onResolve={handleResolve}
            busyField={busyField}
          />

          <ExtractedFieldCard
            title="Parties"
            icon={BusinessOutlinedIcon}
            fields={partyFields}
            exceptions={exceptions}
            pending={pending}
            onResolve={handleResolve}
            busyField={busyField}
          />

          <TotalsCard
            totals={validation?.totals ?? null}
            currency={extracted?.currency ?? null}
            vatRatePct={extracted?.vat_rate_pct ?? null}
            exceptions={exceptions}
            pending={pending}
            onResolve={handleResolve}
            busyField={busyField}
          />

          <LineItemTable
            extractedLines={extracted?.lines ?? []}
            validatedLines={validation?.lines ?? []}
            exceptions={exceptions}
            currency={extracted?.currency ?? null}
            pending={pending}
            onResolve={handleResolve}
            busyField={busyField}
          />

          {validation !== null && (
            <Typography variant="caption" sx={{ color: 'text.secondary', ...breakAnywhere }}>
              Client match {validation.client.match_method}
              {validation.client.matched ? '' : ' · store unresolved'} · lines matched{' '}
              {formatPct(
                (validation.lines.filter((line) => line.minos_id !== null).length /
                  Math.max(1, validation.lines.length)) *
                  100,
                0,
              )}{' '}
              · extraction {formatMs(order.timings.extraction_ms)} · validation{' '}
              {formatMs(order.timings.validation_ms)}
              {order.approved_at !== null ? ` · approved ${formatDateTime(order.approved_at)}` : ''}
              {validation.lines.length === 0 ? ` · ${DASH}` : ''}
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
}
