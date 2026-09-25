import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, Paper, Skeleton, Typography } from '@mui/material';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded';
import { api } from '../api/client';
import type { Order, OrderException, OrderSummary } from '../api/types';
import { marsTokens } from '../theme/marsTheme';
import { breakAnywhere, stackGrid } from '../theme/layout';
import { DASH, formatCount, formatDateTime, formatMoney } from '../utils/format';
import { ExceptionCard } from '../components/ExceptionCard';
import { StatusPill } from '../components/StatusPill';

/** Long enough for the fade-and-collapse to read, short enough not to stall the demo. */
const EXIT_MS = 460;

interface ExceptionsPageProps {
  orders: OrderSummary[];
  ordersLoading: boolean;
  onOrdersChanged: () => void;
  onSelectOrder: (orderId: string) => void;
}

export function ExceptionsPage({
  orders,
  ordersLoading,
  onOrdersChanged,
  onSelectOrder,
}: ExceptionsPageProps) {
  const [items, setItems] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exiting, setExiting] = useState<string[]>([]);
  const exitingRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<number[]>([]);

  const targetKey = useMemo(
    () =>
      orders
        .filter((order) => order.exception_count > 0)
        .map((order) => order.order_id)
        .sort()
        .join('|'),
    [orders],
  );

  useEffect(
    () => () => {
      for (const timer of timersRef.current) window.clearTimeout(timer);
    },
    [],
  );

  useEffect(() => {
    const ids = targetKey === '' ? [] : targetKey.split('|');
    let cancelled = false;
    if (ids.length === 0) {
      // Keep whatever is mid-animation; everything else clears.
      setItems((prev) => prev.filter((item) => exitingRef.current.has(item.order_id)));
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    void Promise.all(ids.map((id) => api.order(id).catch(() => null)))
      .then((results) => {
        if (cancelled) return;
        const fetched = results.filter((order): order is Order => order !== null);
        setItems((prev) => {
          const stillExiting = prev.filter(
            (item) =>
              exitingRef.current.has(item.order_id) &&
              !fetched.some((next) => next.order_id === item.order_id),
          );
          return [...fetched, ...stillExiting].sort((a, b) =>
            b.received_at.localeCompare(a.received_at),
          );
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [targetKey]);

  const handleResolve = useCallback(
    async (orderId: string, exception: OrderException, value: string): Promise<void> => {
      if (value.length === 0) return;
      const key = `${orderId}:${exception.field}`;
      setBusyKey(key);
      setError(null);
      try {
        const next = await api.resolve(orderId, {
          field: exception.field,
          value,
          line_index: exception.line_index,
        });
        setItems((prev) => prev.map((item) => (item.order_id === orderId ? next : item)));

        const stillOpen = (next.validation?.exceptions ?? []).some((item) => !item.resolved);
        if (!stillOpen) {
          exitingRef.current.add(orderId);
          setExiting((prev) => [...prev, orderId]);
          const timer = window.setTimeout(() => {
            exitingRef.current.delete(orderId);
            setExiting((prev) => prev.filter((id) => id !== orderId));
            setItems((prev) => prev.filter((item) => item.order_id !== orderId));
          }, EXIT_MS);
          timersRef.current.push(timer);
        }
        onOrdersChanged();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not apply the change.');
      } finally {
        setBusyKey(null);
      }
    },
    [onOrdersChanged],
  );

  const groups = items
    .map((order) => ({
      order,
      open: (order.validation?.exceptions ?? []).filter((item) => !item.resolved),
    }))
    .filter((group) => group.open.length > 0 || exitingRef.current.has(group.order.order_id));

  const totalOpen = groups.reduce((sum, group) => sum + group.open.length, 0);
  const busy = loading || ordersLoading;

  return (
    <Box sx={{ ...stackGrid, gap: 2.5 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h6" sx={{ color: 'text.secondary', mb: 0.5 }}>
          Human in the loop
        </Typography>
        <Typography variant="h2" sx={{ ...breakAnywhere }}>
          Exception queue
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.75 }}>
          {busy && groups.length === 0
            ? 'Loading the queue…'
            : totalOpen === 0
              ? 'Every order the agents processed came through clean.'
              : `${formatCount(totalOpen)} ${totalOpen === 1 ? 'item' : 'items'} across ${formatCount(groups.length)} ${groups.length === 1 ? 'order' : 'orders'} · each one names the field, what was observed and what was expected.`}
        </Typography>
      </Box>

      {error !== null && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {busy && groups.length === 0 ? (
        <Paper sx={{ borderRadius: 3, p: 3, minWidth: 0 }}>
          <Skeleton width="38%" height={24} />
          <Skeleton height={96} sx={{ mt: 1.5 }} />
          <Skeleton height={96} sx={{ mt: 1 }} />
        </Paper>
      ) : groups.length === 0 ? (
        <Paper
          sx={{
            borderRadius: 3,
            p: { xs: 4, md: 6 },
            textAlign: 'center',
            minWidth: 0,
            background: 'linear-gradient(160deg, #FFFFFF 0%, #F2FFFC 100%)',
            border: `1px solid ${marsTokens.marsGreen}3D`,
          }}
        >
          <CheckCircleOutlineRoundedIcon sx={{ fontSize: 44, color: marsTokens.marsGreen }} />
          <Typography variant="h3" sx={{ mt: 1.5 }}>
            Nothing waiting on you
          </Typography>
          <Typography
            variant="body1"
            sx={{ mt: 1, color: 'text.secondary', maxWidth: 480, mx: 'auto' }}
          >
            Every order in this session reconciled against master data on its own. The queue fills only when
            an agent cannot resolve a store number, an item mapping or a total with confidence.
          </Typography>
          <Button
            component={RouterLink}
            to="/"
            endIcon={<ArrowForwardRoundedIcon sx={{ fontSize: 18 }} />}
            sx={{ mt: 2.5 }}
          >
            Back to the dashboard
          </Button>
        </Paper>
      ) : (
        <Box sx={{ ...stackGrid, gap: 2 }}>
          {groups.map(({ order, open }) => {
            const leaving = exiting.includes(order.order_id);
            return (
              <Paper
                key={order.order_id}
                sx={{
                  borderRadius: 3,
                  minWidth: 0,
                  overflow: 'hidden',
                  ...stackGrid,
                  boxShadow: 'var(--shadow-card)',
                  ...(leaving
                    ? { animation: `mars-fade-out ${EXIT_MS}ms ease-in forwards` }
                    : { animation: 'mars-fade-up 260ms ease-out' }),
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 2,
                    flexWrap: 'wrap',
                    px: 2.25,
                    py: 1.75,
                    borderBottom: '1px solid rgba(0,0,32,0.07)',
                    bgcolor: '#FAFAFC',
                    minWidth: 0,
                  }}
                >
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap', minWidth: 0 }}>
                      <Typography
                        sx={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '1rem',
                          fontWeight: 800,
                          ...breakAnywhere,
                        }}
                      >
                        {order.extracted?.order_number ?? order.filename}
                      </Typography>
                      <StatusPill status={order.status} dense />
                    </Box>
                    <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, ...breakAnywhere }}>
                      Markt {order.extracted?.markt ?? DASH}
                      {order.validation?.client.name ? ` · ${order.validation.client.name}` : ''} ·{' '}
                      {formatMoney(
                        order.validation?.totals.total_recomputed ?? order.extracted?.total ?? null,
                        order.extracted?.currency ?? null,
                      )}{' '}
                      · received {formatDateTime(order.received_at)}
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    variant="outlined"
                    component={RouterLink}
                    to={`/orders/${order.order_id}`}
                    onClick={() => onSelectOrder(order.order_id)}
                    endIcon={<ArrowForwardRoundedIcon sx={{ fontSize: 16 }} />}
                    sx={{ flexShrink: 0 }}
                  >
                    Open beside the PDF
                  </Button>
                </Box>

                <Box sx={{ ...stackGrid, gap: 1.5, p: 2.25 }}>
                  {leaving && open.length === 0 ? (
                    <Typography variant="body2" sx={{ color: marsTokens.marsGreen, fontWeight: 700 }}>
                      Resolved — this order is now ready.
                    </Typography>
                  ) : (
                    open.map((exception) => (
                      <ExceptionCard
                        key={`${exception.kind}-${exception.field}`}
                        exception={exception}
                        variant="queue"
                        busy={busyKey === `${order.order_id}:${exception.field}`}
                        onResolve={(item, value) => handleResolve(order.order_id, item, value)}
                      />
                    ))
                  )}
                </Box>
              </Paper>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
