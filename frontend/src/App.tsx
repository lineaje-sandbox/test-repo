import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api/client';
import type { AgentProfile, AppConfig, OrderStatus, OrderSummary, UploadResponse } from './api/types';
import { useOrderStream } from './api/useOrderStream';
import { AppShell } from './components/AppShell';
import { AgentRail } from './components/AgentRail';
import { UploadDialog } from './components/UploadDialog';
import { DashboardPage } from './pages/DashboardPage';
import { ExceptionsPage } from './pages/ExceptionsPage';
import { WorkbenchPage } from './pages/WorkbenchPage';

const IN_FLIGHT: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'RECEIVED',
  'EXTRACTING',
  'VALIDATING',
]);

const POLL_ACTIVE_MS = 2_500;
const POLL_IDLE_MS = 15_000;

export function App() {
  const location = useLocation();
  const navigate = useNavigate();

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [stickyOrderId, setStickyOrderId] = useState<string | null>(null);

  const routeOrderId = useMemo(() => {
    const match = /^\/orders\/([^/]+)/.exec(location.pathname);
    const raw = match?.[1];
    return raw === undefined ? null : decodeURIComponent(raw);
  }, [location.pathname]);

  // The rail is persistent, so leaving the workbench keeps watching the last run
  // instead of resetting to an empty pipeline.
  useEffect(() => {
    if (routeOrderId !== null) setStickyOrderId(routeOrderId);
  }, [routeOrderId]);

  const activeOrderId = routeOrderId ?? stickyOrderId;
  const stream = useOrderStream(activeOrderId);

  const loadConfig = useCallback(async () => {
    try {
      setConfig(await api.config());
      setConfigError(null);
    } catch (cause) {
      setConfigError(
        cause instanceof Error
          ? cause.message
          : 'The order processing service did not respond to the configuration request.',
      );
    }
  }, []);

  const loadOrders = useCallback(async (showSpinner = false) => {
    if (showSpinner) setOrdersLoading(true);
    try {
      setOrders(await api.orders());
    } catch {
      /* the offline banner already covers an unreachable backend */
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    void loadOrders(true);
  }, [loadConfig, loadOrders]);

  const anyInFlight = orders.some((order) => IN_FLIGHT.has(order.status));

  useEffect(() => {
    const interval = window.setInterval(
      () => void loadOrders(false),
      anyInFlight ? POLL_ACTIVE_MS : POLL_IDLE_MS,
    );
    return () => window.clearInterval(interval);
  }, [anyInFlight, loadOrders]);

  // A finished run changes totals, status and exception counts, so refresh once.
  const runState = stream.runState;
  useEffect(() => {
    if (runState === 'complete' || runState === 'error') void loadOrders(false);
  }, [runState, activeOrderId, loadOrders]);

  const handleUploaded = useCallback(
    (response: UploadResponse) => {
      setStickyOrderId(response.order_id);
      void loadOrders(false);
      navigate(`/orders/${encodeURIComponent(response.order_id)}`);
    },
    [loadOrders, navigate],
  );

  const handleSelectOrder = useCallback(
    (orderId: string) => {
      setStickyOrderId(orderId);
      navigate(`/orders/${encodeURIComponent(orderId)}`);
    },
    [navigate],
  );

  const refreshOrders = useCallback(() => void loadOrders(false), [loadOrders]);

  /** Config is the source of truth for the pipeline; the stream can only add to it. */
  const railAgents = useMemo<AgentProfile[]>(() => {
    const fromConfig = config?.agents ?? [];
    if (fromConfig.length === 0) return stream.streamedAgents;
    const known = new Set(fromConfig.map((agent) => agent.key));
    return [...fromConfig, ...stream.streamedAgents.filter((agent) => !known.has(agent.key))];
  }, [config, stream.streamedAgents]);

  const openExceptionCount = orders
    .filter((order) => order.status === 'EXCEPTION')
    .reduce((sum, order) => sum + order.exception_count, 0);

  const rail = (
    <AgentRail
      agents={railAgents}
      steps={stream.steps}
      runState={stream.runState}
      elapsedMs={stream.elapsedMs}
      orderId={activeOrderId}
      orderLabel={stream.order?.extracted?.order_number ?? stream.order?.filename ?? null}
      endpointLocation={config?.endpoint_location ?? null}
      error={stream.error}
    />
  );

  return (
    <>
      <AppShell
        rail={rail}
        onUpload={() => setUploadOpen(true)}
        activeOrderId={activeOrderId}
        openExceptionCount={openExceptionCount}
        offlineMessage={
          configError === null
            ? null
            : `${configError} Screens render from live data only, so figures stay blank until it recovers.`
        }
        onRetry={() => {
          void loadConfig();
          void loadOrders(true);
        }}
      >
        <Routes>
          <Route
            path="/"
            element={
              <DashboardPage
                config={config}
                orders={orders}
                ordersLoading={ordersLoading}
                activeOrderId={activeOrderId}
                onUpload={() => setUploadOpen(true)}
                onSelectOrder={handleSelectOrder}
              />
            }
          />
          <Route
            path="/orders/:id"
            element={<WorkbenchPage stream={stream} onOrdersChanged={refreshOrders} />}
          />
          <Route
            path="/exceptions"
            element={
              <ExceptionsPage
                orders={orders}
                ordersLoading={ordersLoading}
                onOrdersChanged={refreshOrders}
                onSelectOrder={handleSelectOrder}
              />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={handleUploaded}
      />
    </>
  );
}
