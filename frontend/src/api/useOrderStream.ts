import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, streamUrl, USE_MOCK } from './client';
import { mockStream } from './mockData';
import type {
  AgentProfile,
  AgentStep,
  ExtractedOrder,
  Order,
  OrderStatus,
  StreamEvent,
  ValidationResult,
} from './types';

export type RunState = 'idle' | 'loading' | 'connecting' | 'running' | 'complete' | 'error';

const TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'READY',
  'EXCEPTION',
  'APPROVED',
  'FAILED',
]);

const RECONNECT_BASE_MS = 750;
const RECONNECT_MAX_MS = 15_000;
/** Steps can land in bursts during a replay; one commit per 250 ms keeps the rail smooth. */
const FLUSH_INTERVAL_MS = 250;
const MOCK_FRAME_MS = 240;

interface LiveState {
  steps: AgentStep[];
  extracted: ExtractedOrder | null;
  validation: ValidationResult | null;
  status: OrderStatus | null;
  agents: AgentProfile[];
  elapsedMs: number;
  eventCount: number;
  runState: RunState;
  error: string | null;
}

const EMPTY_LIVE: LiveState = {
  steps: [],
  extracted: null,
  validation: null,
  status: null,
  agents: [],
  elapsedMs: 0,
  eventCount: 0,
  runState: 'idle',
  error: null,
};

export interface OrderStreamResult {
  /** The order with live stream data merged over the last fetched snapshot. */
  order: Order | null;
  steps: AgentStep[];
  /** Agents seen on the wire this run; empty before the first `agent.started`. */
  streamedAgents: AgentProfile[];
  runState: RunState;
  elapsedMs: number;
  eventCount: number;
  error: string | null;
  loading: boolean;
  /** Replace the snapshot from a resolve/approve response without a refetch. */
  applyOrder: (order: Order) => void;
  refresh: () => Promise<void>;
  reconnect: () => void;
}

/** Newest wins on a seq collision so a RUNNING row can be upgraded to DONE. */
function mergeSteps(...groups: AgentStep[][]): AgentStep[] {
  const bySeq = new Map<number, AgentStep>();
  for (const group of groups) {
    for (const step of group) {
      bySeq.set(step.seq, step);
    }
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

export function useOrderStream(orderId: string | null): OrderStreamResult {
  const [base, setBase] = useState<Order | null>(null);
  const [live, setLive] = useState<LiveState>(EMPTY_LIVE);
  const [loading, setLoading] = useState(false);

  const sourceRef = useRef<EventSource | null>(null);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const flushTimerRef = useRef<number | null>(null);
  const mockTimersRef = useRef<number[]>([]);
  const pendingStepsRef = useRef<AgentStep[]>([]);
  const pendingPatchRef = useRef<Partial<LiveState>>({});
  const eventCountRef = useRef(0);
  const finishedRef = useRef(false);
  const disposedRef = useRef(false);
  const connectRef = useRef<(id: string) => void>(() => {});

  const flush = useCallback(() => {
    const steps = pendingStepsRef.current;
    const patch = pendingPatchRef.current;
    if (steps.length === 0 && Object.keys(patch).length === 0) return;
    pendingStepsRef.current = [];
    pendingPatchRef.current = {};
    setLive((prev) => ({
      ...prev,
      ...patch,
      steps: steps.length === 0 ? prev.steps : mergeSteps(prev.steps, steps),
      eventCount: eventCountRef.current,
    }));
  }, []);

  const queue = useCallback((patch: Partial<LiveState>) => {
    pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
  }, []);

  const handleEvent = useCallback(
    (event: StreamEvent) => {
      eventCountRef.current += 1;

      if (event.type === 'heartbeat') {
        queue({ elapsedMs: event.elapsed_ms });
        return;
      }

      queue({ elapsedMs: event.elapsed_ms, runState: 'running' });

      switch (event.type) {
        case 'run.started':
          if (event.status !== null) queue({ status: event.status });
          break;
        case 'agent.started':
          if (event.agent !== null) {
            const agent = event.agent;
            setLive((prev) =>
              prev.agents.some((known) => known.key === agent.key)
                ? prev
                : { ...prev, agents: [...prev.agents, agent] },
            );
            if (event.status !== null) queue({ status: event.status });
          }
          break;
        case 'step':
          if (event.step !== null) pendingStepsRef.current.push(event.step);
          break;
        case 'extraction.done':
          queue({
            ...(event.extracted !== null ? { extracted: event.extracted } : {}),
            ...(event.status !== null ? { status: event.status } : {}),
          });
          break;
        case 'exception.raised':
          // The full exception list arrives with validation.done; the individual
          // frame is only used to keep elapsed and the event count moving.
          break;
        case 'validation.done':
          queue({
            ...(event.validation !== null ? { validation: event.validation } : {}),
            ...(event.status !== null ? { status: event.status } : {}),
          });
          break;
        case 'order.done':
          finishedRef.current = true;
          queue({ runState: 'complete', ...(event.status !== null ? { status: event.status } : {}) });
          sourceRef.current?.close();
          sourceRef.current = null;
          flush();
          break;
        case 'run.error':
          finishedRef.current = true;
          queue({
            runState: 'error',
            error: event.message ?? 'The agent run failed.',
            ...(event.status !== null ? { status: event.status } : {}),
          });
          sourceRef.current?.close();
          sourceRef.current = null;
          flush();
          break;
      }
    },
    [flush, queue],
  );

  const clearMockTimers = useCallback(() => {
    for (const timer of mockTimersRef.current) window.clearTimeout(timer);
    mockTimersRef.current = [];
  }, []);

  const connect = useCallback(
    (id: string) => {
      if (disposedRef.current || finishedRef.current) return;

      if (USE_MOCK) {
        clearMockTimers();
        queue({ runState: 'running' });
        const frames = mockStream(id);
        frames.forEach((frame, index) => {
          const timer = window.setTimeout(() => {
            if (disposedRef.current) return;
            handleEvent(frame);
          }, index * MOCK_FRAME_MS);
          mockTimersRef.current.push(timer);
        });
        return;
      }

      sourceRef.current?.close();
      queue({ runState: 'connecting' });
      flush();

      const source = new EventSource(streamUrl(id));
      sourceRef.current = source;

      source.onopen = () => {
        retryRef.current = 0;
      };

      const onFrame = (message: Event) => {
        try {
          handleEvent(JSON.parse((message as MessageEvent<string>).data) as StreamEvent);
        } catch {
          /* a malformed frame must not tear down the run */
        }
      };

      // The backend names every frame, and some proxies drop unnamed events, so
      // both the named listeners and the default handler are wired.
      for (const name of [
        'run.started',
        'agent.started',
        'step',
        'extraction.done',
        'exception.raised',
        'validation.done',
        'order.done',
        'run.error',
        'heartbeat',
      ]) {
        source.addEventListener(name, onFrame);
      }
      source.onmessage = onFrame;

      source.onerror = () => {
        source.close();
        if (disposedRef.current || finishedRef.current) return;
        const attempt = retryRef.current;
        retryRef.current = attempt + 1;
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
        queue({ runState: 'connecting' });
        flush();
        retryTimerRef.current = window.setTimeout(() => connectRef.current(id), delay);
      };
    },
    [clearMockTimers, flush, handleEvent, queue],
  );

  connectRef.current = connect;

  const teardown = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    clearMockTimers();
  }, [clearMockTimers]);

  useEffect(() => {
    disposedRef.current = false;
    finishedRef.current = false;
    retryRef.current = 0;
    eventCountRef.current = 0;
    pendingStepsRef.current = [];
    pendingPatchRef.current = {};
    setLive(EMPTY_LIVE);
    setBase(null);

    if (orderId === null) {
      return () => {
        disposedRef.current = true;
        teardown();
      };
    }

    setLoading(true);
    void api
      .order(orderId)
      .then((order) => {
        if (disposedRef.current) return;
        setBase(order);
      })
      .catch((error: unknown) => {
        if (disposedRef.current) return;
        queue({
          runState: 'error',
          error: error instanceof Error ? error.message : 'Could not load the order.',
        });
        flush();
      })
      .finally(() => {
        if (!disposedRef.current) setLoading(false);
      });

    // Subscribe regardless of the snapshot: a finished run replays its recorded
    // steps and then sends order.done, so a late join or refresh still fills the rail.
    connect(orderId);
    flushTimerRef.current = window.setInterval(flush, FLUSH_INTERVAL_MS);

    return () => {
      disposedRef.current = true;
      teardown();
      if (flushTimerRef.current !== null) {
        window.clearInterval(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, [orderId, connect, flush, queue, teardown]);

  const applyOrder = useCallback((next: Order) => {
    setBase(next);
    // Drop the live overlay so the freshly revalidated snapshot is what renders.
    setLive((prev) => ({ ...prev, extracted: null, validation: null, status: null }));
  }, []);

  const refresh = useCallback(async () => {
    if (orderId === null) return;
    try {
      const next = await api.order(orderId);
      if (!disposedRef.current) applyOrder(next);
    } catch {
      /* the on-screen snapshot stays; the error surfaces on the next action */
    }
  }, [orderId, applyOrder]);

  const reconnect = useCallback(() => {
    if (orderId === null) return;
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryRef.current = 0;
    finishedRef.current = false;
    queue({ error: null });
    connect(orderId);
  }, [connect, orderId, queue]);

  const steps = useMemo(() => mergeSteps(base?.steps ?? [], live.steps), [base, live.steps]);

  const order = useMemo<Order | null>(() => {
    if (base === null) return null;
    return {
      ...base,
      status: live.status ?? base.status,
      extracted: live.extracted ?? base.extracted,
      validation: live.validation ?? base.validation,
      steps,
    };
  }, [base, live.status, live.extracted, live.validation, steps]);

  const runState = useMemo<RunState>(() => {
    if (orderId === null) return 'idle';
    if (live.runState !== 'idle') return live.runState;
    if (base !== null && TERMINAL_STATUSES.has(base.status)) return 'complete';
    return 'loading';
  }, [orderId, live.runState, base]);

  const elapsedMs = live.elapsedMs > 0 ? live.elapsedMs : (base?.timings.total_ms ?? 0);

  return {
    order,
    steps,
    streamedAgents: live.agents,
    runState,
    elapsedMs,
    eventCount: live.eventCount,
    error: live.error,
    loading,
    applyOrder,
    refresh,
    reconnect,
  };
}
