import { Box, Paper, Skeleton, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import type { OrderStatus, OrderSummary } from '../api/types';
import { marsTokens } from '../theme/marsTheme';
import { breakAnywhere, scrollX } from '../theme/layout';
import { DASH, formatClock, formatCount, formatMoney } from '../utils/format';
import { StatusPill } from './StatusPill';
import { ElapsedTimer } from './ElapsedTimer';

const IN_FLIGHT: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'RECEIVED',
  'EXTRACTING',
  'VALIDATING',
]);

interface OrderTableProps {
  orders: OrderSummary[];
  loading: boolean;
  activeOrderId: string | null;
  onSelect: (orderId: string) => void;
  emptyMessage?: string;
}

export function OrderTable({
  orders,
  loading,
  activeOrderId,
  onSelect,
  emptyMessage = 'No orders yet. Upload a purchase order PDF to start a run.',
}: OrderTableProps) {
  if (loading) {
    return (
      <Paper sx={{ borderRadius: 3, p: 2, minWidth: 0 }}>
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} height={44} sx={{ mb: 0.5 }} />
        ))}
      </Paper>
    );
  }

  if (orders.length === 0) {
    return (
      <Paper sx={{ borderRadius: 3, p: 4, textAlign: 'center', minWidth: 0 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {emptyMessage}
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ borderRadius: 3, overflow: 'hidden', minWidth: 0, boxShadow: 'var(--shadow-card)' }}>
      <Box sx={scrollX}>
        <Table size="small" sx={{ minWidth: 880 }}>
          <TableHead>
            <TableRow>
              <TableCell>Order</TableCell>
              <TableCell>Markt</TableCell>
              <TableCell>Store</TableCell>
              <TableCell align="right">Lines</TableCell>
              <TableCell align="right">Total</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Exceptions</TableCell>
              <TableCell align="right">Elapsed</TableCell>
              <TableCell sx={{ width: 32 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {orders.map((order) => {
              const running = IN_FLIGHT.has(order.status);
              const selected = order.order_id === activeOrderId;
              return (
                <TableRow
                  key={order.order_id}
                  hover
                  onClick={() => onSelect(order.order_id)}
                  sx={{
                    cursor: 'pointer',
                    bgcolor: selected ? 'rgba(0,0,160,0.04)' : 'transparent',
                    '&:last-of-type td': { borderBottom: 0 },
                  }}
                >
                  <TableCell sx={{ maxWidth: 190 }}>
                    <Typography
                      sx={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.8125rem',
                        fontWeight: 700,
                        lineHeight: 1.3,
                        ...breakAnywhere,
                      }}
                    >
                      {order.order_number ?? DASH}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{ color: 'text.secondary', display: 'block', ...breakAnywhere }}
                    >
                      {order.filename} · {formatClock(order.received_at)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography
                      sx={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', fontWeight: 600 }}
                    >
                      {order.markt ?? DASH}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 200 }}>
                    <Typography variant="body2" sx={{ ...breakAnywhere }}>
                      {order.markt_name ?? DASH}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {order.line_count > 0 ? formatCount(order.line_count) : DASH}
                  </TableCell>
                  <TableCell
                    align="right"
                    sx={{
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatMoney(order.total, order.currency)}
                  </TableCell>
                  <TableCell>
                    <StatusPill status={order.status} dense />
                  </TableCell>
                  <TableCell align="right">
                    {order.exception_count === 0 ? (
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        {DASH}
                      </Typography>
                    ) : (
                      <Typography
                        sx={{
                          fontSize: '0.8125rem',
                          fontWeight: 800,
                          whiteSpace: 'nowrap',
                          color:
                            order.blocking_count > 0 ? marsTokens.marsPetcareRed : marsTokens.marsWrigley,
                        }}
                      >
                        {order.exception_count}
                        {order.blocking_count > 0 ? ` (${order.blocking_count} blocking)` : ''}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>
                    <ElapsedTimer
                      running={running}
                      startedAt={order.received_at}
                      valueMs={order.timings.total_ms}
                    />
                  </TableCell>
                  <TableCell sx={{ width: 32, pl: 0 }}>
                    <ChevronRightRoundedIcon sx={{ fontSize: 18, color: marsTokens.lightGray }} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Box>
    </Paper>
  );
}
