import { useMemo } from 'react';
import { Box, Paper, Skeleton, Typography } from '@mui/material';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import BoltOutlinedIcon from '@mui/icons-material/BoltOutlined';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';
import type { SvgIconComponent } from '@mui/icons-material';
import type { OrderStatus, OrderSummary } from '../api/types';
import { marsTokens } from '../theme/marsTheme';
import { DASH, formatCount, formatMs, formatPct } from '../utils/format';

const SETTLED: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'READY',
  'EXCEPTION',
  'APPROVED',
  'FAILED',
]);

interface Kpi {
  key: string;
  label: string;
  value: string;
  footnote: string;
  accent: string;
  icon: SvgIconComponent;
}

/**
 * Every figure is derived from GET /orders. Where there is no data the card shows
 * an em dash — a fabricated zero would be worse than an honest gap in a pitch.
 */
function buildKpis(orders: OrderSummary[]): Kpi[] {
  const settled = orders.filter((order) => SETTLED.has(order.status));
  const inFlight = orders.length - settled.length;
  const clean = settled.filter((order) => order.exception_count === 0 && order.status !== 'FAILED');
  const openExceptionOrders = orders.filter((order) => order.status === 'EXCEPTION');
  const openExceptions = openExceptionOrders.reduce((sum, order) => sum + order.exception_count, 0);
  const openBlocking = openExceptionOrders.reduce((sum, order) => sum + order.blocking_count, 0);
  const durations = orders
    .map((order) => order.timings.total_ms)
    .filter((value): value is number => value !== null && value > 0);
  const avg =
    durations.length === 0 ? null : durations.reduce((sum, value) => sum + value, 0) / durations.length;

  return [
    {
      key: 'processed',
      label: 'Orders processed',
      value: orders.length === 0 ? DASH : formatCount(settled.length),
      footnote:
        orders.length === 0
          ? 'No documents received yet this session'
          : `${formatCount(orders.length)} received · ${inFlight > 0 ? `${inFlight} in flight` : 'none in flight'}`,
      accent: marsTokens.marsBlue,
      icon: ReceiptLongOutlinedIcon,
    },
    {
      key: 'straight-through',
      label: 'Straight-through rate',
      value: settled.length === 0 ? DASH : formatPct((clean.length / settled.length) * 100, 0),
      footnote:
        settled.length === 0
          ? 'Available once the first order settles'
          : `${formatCount(clean.length)} of ${formatCount(settled.length)} needed no human touch`,
      accent: marsTokens.marsGreen,
      icon: BoltOutlinedIcon,
    },
    {
      key: 'exceptions',
      label: 'Exceptions open',
      value: orders.length === 0 ? DASH : formatCount(openExceptions),
      footnote:
        orders.length === 0
          ? 'Nothing in the queue'
          : openExceptions === 0
            ? 'Queue is clear'
            : `${formatCount(openBlocking)} blocking · across ${formatCount(openExceptionOrders.length)} ${openExceptionOrders.length === 1 ? 'order' : 'orders'}`,
      accent: openExceptions > 0 ? marsTokens.marsPetcareRed : marsTokens.lightGray,
      icon: ReportProblemOutlinedIcon,
    },
    {
      key: 'handling',
      label: 'Average handling time',
      value: avg === null ? DASH : formatMs(avg),
      footnote:
        avg === null
          ? 'Measured end to end, upload to decision'
          : `Across ${formatCount(durations.length)} completed ${durations.length === 1 ? 'run' : 'runs'}`,
      accent: marsTokens.marsEdge,
      icon: TimerOutlinedIcon,
    },
  ];
}

interface KpiStripProps {
  orders: OrderSummary[];
  loading: boolean;
}

export function KpiStrip({ orders, loading }: KpiStripProps) {
  const kpis = useMemo(() => buildKpis(orders), [orders]);

  return (
    <Box
      sx={{
        display: 'grid',
        // auto-fit against the container, because the content column loses 340px
        // to the agent rail at lg and viewport breakpoints cannot express that.
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(236px, 100%), 1fr))',
        gap: 2,
      }}
    >
      {loading
        ? Array.from({ length: 4 }, (_, index) => (
            <Paper key={index} sx={{ p: 2.5, borderRadius: 3 }}>
              <Skeleton width="55%" height={14} />
              <Skeleton width="38%" height={44} sx={{ my: 0.5 }} />
              <Skeleton width="72%" height={12} />
            </Paper>
          ))
        : kpis.map(({ key, label, value, footnote, accent, icon: Icon }) => (
            <Paper
              key={key}
              sx={{
                position: 'relative',
                p: 2.5,
                borderRadius: 3,
                overflow: 'hidden',
                minWidth: 0,
                boxShadow: 'var(--shadow-card)',
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  inset: '0 auto 0 0',
                  width: 3,
                  bgcolor: accent,
                },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                <Typography variant="h6" sx={{ color: 'text.secondary', minWidth: 0 }}>
                  {label}
                </Typography>
                <Icon sx={{ fontSize: 20, color: accent, opacity: 0.85, flexShrink: 0 }} />
              </Box>
              <Typography
                sx={{
                  mt: 0.75,
                  fontSize: '2.125rem',
                  fontWeight: 800,
                  lineHeight: 1.05,
                  letterSpacing: '-0.02em',
                  fontVariantNumeric: 'tabular-nums',
                  color: marsTokens.darkGrey,
                }}
              >
                {value}
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
                {footnote}
              </Typography>
            </Paper>
          ))}
    </Box>
  );
}
