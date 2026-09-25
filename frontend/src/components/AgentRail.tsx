import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, IconButton, LinearProgress, Tooltip, Typography } from '@mui/material';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import type { AgentProfile, AgentStep } from '../api/types';
import type { RunState } from '../api/useOrderStream';
import { marsTokens } from '../theme/marsTheme';
import { breakAnywhere, stackGrid } from '../theme/layout';
import { formatMs } from '../utils/format';
import { AgentStepRow, ModelChip } from './AgentStepRow';

type AgentRunState = 'idle' | 'running' | 'done' | 'failed';

interface RailPill {
  label: string;
  color: string;
  pulse: boolean;
}

function pillFor(runState: RunState, hasOrder: boolean): RailPill {
  if (!hasOrder) return { label: 'Idle', color: 'rgba(255,255,255,0.55)', pulse: false };
  switch (runState) {
    case 'complete':
      return { label: 'Complete', color: marsTokens.marsGreen, pulse: false };
    case 'error':
      return { label: 'Failed', color: marsTokens.marsPetcareRed, pulse: false };
    case 'idle':
      return { label: 'Idle', color: 'rgba(255,255,255,0.55)', pulse: false };
    default:
      return { label: 'Running', color: marsTokens.skyBlue, pulse: true };
  }
}

/** Replay paces itself off the recorded durations, clamped so the demo stays watchable. */
function replayDelay(step: AgentStep | undefined): number {
  const recorded = step?.elapsed_ms ?? 120;
  return Math.min(700, Math.max(90, Math.round(recorded / 4)));
}

interface AgentRailProps {
  agents: AgentProfile[];
  steps: AgentStep[];
  runState: RunState;
  elapsedMs: number;
  orderId: string | null;
  orderLabel: string | null;
  endpointLocation: string | null;
  error: string | null;
}

export function AgentRail({
  agents,
  steps,
  runState,
  elapsedMs,
  orderId,
  orderLabel,
  endpointLocation,
  error,
}: AgentRailProps) {
  const [replayCount, setReplayCount] = useState<number | null>(null);
  const [nearBottom, setNearBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const prevMaxSeqRef = useRef(0);

  useEffect(() => {
    setReplayCount(null);
    prevMaxSeqRef.current = 0;
  }, [orderId]);

  const replaying = replayCount !== null && replayCount < steps.length;

  useEffect(() => {
    if (replayCount === null || replayCount >= steps.length) return undefined;
    const timer = window.setTimeout(
      () => setReplayCount((current) => (current === null ? null : current + 1)),
      replayDelay(steps[replayCount]),
    );
    return () => window.clearTimeout(timer);
  }, [replayCount, steps]);

  const visibleSteps = useMemo(
    () => (replayCount === null ? steps : steps.slice(0, replayCount)),
    [replayCount, steps],
  );

  const maxSeq = visibleSteps.length > 0 ? (visibleSteps[visibleSteps.length - 1]?.seq ?? 0) : 0;
  const animateAboveSeq = prevMaxSeqRef.current;

  useEffect(() => {
    prevMaxSeqRef.current = maxSeq;
  }, [maxSeq]);

  // Only follow the stream when the reader has not scrolled away from the tail.
  useEffect(() => {
    if (!nearBottom) return;
    const node = scrollRef.current;
    if (node === null) return;
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  }, [maxSeq, nearBottom]);

  const onScroll = useCallback(() => {
    const node = scrollRef.current;
    if (node === null) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    setNearBottom(distance < 120);
  }, []);

  const pill = pillFor(runState, orderId !== null);
  const totalElapsed = elapsedMs > 0 ? elapsedMs : steps.reduce((sum, s) => sum + (s.elapsed_ms ?? 0), 0);

  const stepsByAgent = useMemo(() => {
    const grouped = new Map<string, AgentStep[]>();
    for (const step of visibleSteps) {
      const bucket = grouped.get(step.agent);
      if (bucket === undefined) grouped.set(step.agent, [step]);
      else bucket.push(step);
    }
    return grouped;
  }, [visibleSteps]);

  const agentStateFor = (agent: AgentProfile, index: number): AgentRunState => {
    const own = stepsByAgent.get(agent.key) ?? [];
    if (own.some((step) => step.status === 'FAILED')) return 'failed';
    if (own.some((step) => step.status === 'RUNNING')) return 'running';
    if (own.length === 0) return 'idle';
    const laterHasWork = agents
      .slice(index + 1)
      .some((later) => (stepsByAgent.get(later.key) ?? []).length > 0);
    if (laterHasWork) return 'done';
    if (runState === 'complete') return 'done';
    if (runState === 'error') return 'failed';
    return replaying || runState === 'running' || runState === 'connecting' ? 'running' : 'done';
  };

  return (
    <Box sx={{ ...stackGrid, height: '100%', gridTemplateRows: 'auto minmax(0, 1fr) auto' }}>
      {/* Header — the one band of colour in the rail, so the eye lands here first. */}
      <Box
        sx={{
          px: 2.25,
          pt: 2.25,
          pb: 2,
          color: marsTokens.white,
          background: `linear-gradient(145deg, ${marsTokens.marsBlue} 0%, #0B0B8C 52%, ${marsTokens.marsEdge} 160%)`,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            opacity: 0.16,
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.9) 1px, transparent 0)',
            backgroundSize: '14px 14px',
          }}
        />
        <Box sx={{ position: 'relative', ...stackGrid, gap: 1.25 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <Typography
              variant="h6"
              sx={{ color: marsTokens.white, flex: 1, minWidth: 0, letterSpacing: '0.12em' }}
            >
              Agent activity
            </Typography>
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.75,
                px: 1,
                py: 0.375,
                borderRadius: 999,
                flexShrink: 0,
                border: `1px solid ${pill.color}66`,
                bgcolor: 'rgba(255,255,255,0.12)',
              }}
            >
              <Box sx={{ position: 'relative', width: 7, height: 7 }}>
                {pill.pulse && (
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      borderRadius: '50%',
                      bgcolor: pill.color,
                      animation: 'mars-pulse 1.6s ease-out infinite',
                    }}
                  />
                )}
                <Box sx={{ position: 'absolute', inset: 0, borderRadius: '50%', bgcolor: pill.color }} />
              </Box>
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 800,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: marsTokens.white,
                }}
              >
                {pill.label}
              </Typography>
            </Box>
          </Box>

          <Typography
            variant="caption"
            sx={{ color: 'rgba(255,255,255,0.82)', lineHeight: 1.5, ...breakAnywhere }}
          >
            {orderLabel !== null
              ? `Watching order ${orderLabel}`
              : 'No run selected — upload an order to watch the pipeline.'}
          </Typography>

          {/* The whole point of the rail: which work was Gemini, which was Python. */}
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 0.75,
              px: 1.125,
              py: 0.875,
              borderRadius: 1.5,
              bgcolor: 'rgba(0,0,0,0.20)',
              border: '1px solid rgba(255,255,255,0.16)',
            }}
          >
            <Typography
              variant="caption"
              sx={{ color: 'rgba(255,255,255,0.92)', lineHeight: 1.55, ...breakAnywhere }}
            >
              Rows tagged with a model identifier were answered by Gemini. Rows tagged with a{' '}
              <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                tool()
              </Box>{' '}
              ran as deterministic Python — the numbers came from code, the judgement came from the model.
            </Typography>
          </Box>
        </Box>

        {/* Absolutely positioned so the grid keeps exactly three rows. */}
        {(runState === 'running' || runState === 'connecting' || replaying) && (
          <LinearProgress
            sx={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: 3,
              borderRadius: 0,
              bgcolor: 'rgba(255,255,255,0.22)',
              '& .MuiLinearProgress-bar': { bgcolor: marsTokens.skyBlue, borderRadius: 0 },
            }}
          />
        )}
      </Box>

      <Box
        ref={scrollRef}
        onScroll={onScroll}
        sx={{ minHeight: 0, overflowY: 'auto', overflowX: 'hidden', px: 2, py: 2, ...stackGrid, gap: 2, alignContent: 'start' }}
      >
        {error !== null && (
          <Box
            sx={{
              p: 1.5,
              borderRadius: 1.5,
              border: `1px solid ${marsTokens.marsPetcareRed}44`,
              bgcolor: `${marsTokens.marsPetcareRed}0D`,
            }}
          >
            <Typography variant="body2" sx={{ color: marsTokens.marsPetcareRed, ...breakAnywhere }}>
              {error}
            </Typography>
          </Box>
        )}

        {agents.length === 0 && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Agent profiles load from the service configuration. Start the backend to populate the pipeline.
          </Typography>
        )}

        {agents.map((agent, index) => {
          const own = stepsByAgent.get(agent.key) ?? [];
          const state = agentStateFor(agent, index);
          const agentElapsed = own.reduce((sum, step) => sum + (step.elapsed_ms ?? 0), 0);
          const inferenceLocation = agent.endpoint_location || endpointLocation || 'region unknown';
          const stateColor =
            state === 'failed'
              ? marsTokens.marsPetcareRed
              : state === 'running'
                ? marsTokens.marsEdge
                : state === 'done'
                  ? marsTokens.marsGreen
                  : marsTokens.lightGray;

          return (
            <Box key={agent.key} sx={{ ...stackGrid, gap: 1.5 }}>
              <Box
                sx={{
                  ...stackGrid,
                  gap: 1,
                  p: 1.5,
                  borderRadius: 2,
                  bgcolor: marsTokens.white,
                  border: '1px solid rgba(0,0,32,0.08)',
                  boxShadow: 'var(--shadow-card)',
                  borderLeft: `3px solid ${stateColor}`,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, minWidth: 0 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                      <Typography
                        variant="caption"
                        sx={{
                          flexShrink: 0,
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          display: 'grid',
                          placeItems: 'center',
                          bgcolor: 'rgba(0,0,32,0.06)',
                          fontWeight: 800,
                          color: 'text.secondary',
                        }}
                      >
                        {index + 1}
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: '0.875rem',
                          fontWeight: 800,
                          lineHeight: 1.3,
                          minWidth: 0,
                          ...breakAnywhere,
                        }}
                      >
                        {agent.label}
                      </Typography>
                    </Box>
                    <Typography
                      variant="body2"
                      sx={{ mt: 0.375, color: 'text.secondary', fontSize: '0.75rem', ...breakAnywhere }}
                    >
                      {agent.role}
                    </Typography>
                  </Box>
                  <Tooltip title={`Model card for ${agent.model}`}>
                    <IconButton
                      size="small"
                      component="a"
                      href={agent.model_card}
                      target="_blank"
                      rel="noreferrer noopener"
                      sx={{ mt: -0.5, flexShrink: 0, color: 'text.secondary' }}
                      aria-label={`Open the model card for ${agent.model}`}
                    >
                      <InfoOutlinedIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                </Box>

                <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                  <ModelChip model={agent.model} tier={agent.model_tier} size="md" />
                  <Tooltip
                    title={
                      inferenceLocation === 'global'
                        ? 'Gemini 3.x is served only from Google\u2019s global endpoint for this project, so the model call is not region-pinned.'
                        : `Model inference is pinned to ${inferenceLocation}.`
                    }
                  >
                    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
                      <PlaceOutlinedIcon sx={{ fontSize: 13, color: 'text.secondary' }} />
                      <Typography
                        variant="caption"
                        sx={{ color: 'text.secondary', fontFamily: 'var(--font-mono)' }}
                      >
                        {inferenceLocation}
                      </Typography>
                    </Box>
                  </Tooltip>
                </Box>

                {agent.engine_id !== null && (
                  <Typography
                    variant="caption"
                    sx={{ color: 'text.disabled', fontFamily: 'var(--font-mono)', ...breakAnywhere }}
                  >
                    {agent.runtime}
                    {agent.engine_location !== null && ` \u00b7 ${agent.engine_location}`}
                    {` \u00b7 engine ${agent.engine_id}`}
                  </Typography>
                )}

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                  {state === 'running' ? (
                    <>
                      <Box sx={{ position: 'relative', width: 8, height: 8, flexShrink: 0 }}>
                        <Box
                          sx={{
                            position: 'absolute',
                            inset: 0,
                            borderRadius: '50%',
                            bgcolor: marsTokens.marsEdge,
                            animation: 'mars-pulse 1.5s ease-out infinite',
                          }}
                        />
                        <Box
                          sx={{
                            position: 'absolute',
                            inset: 0,
                            borderRadius: '50%',
                            bgcolor: marsTokens.marsEdge,
                          }}
                        />
                      </Box>
                      <Typography variant="caption" sx={{ fontWeight: 800, color: marsTokens.marsEdge }}>
                        Running
                      </Typography>
                    </>
                  ) : state === 'done' ? (
                    <>
                      <CheckCircleRoundedIcon sx={{ fontSize: 15, color: marsTokens.marsGreen }} />
                      <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.secondary' }}>
                        Done
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          ml: 'auto',
                          fontFamily: 'var(--font-mono)',
                          fontVariantNumeric: 'tabular-nums',
                          color: 'text.secondary',
                        }}
                      >
                        {formatMs(agentElapsed)}
                      </Typography>
                    </>
                  ) : state === 'failed' ? (
                    <>
                      <ErrorRoundedIcon sx={{ fontSize: 15, color: marsTokens.marsPetcareRed }} />
                      <Typography
                        variant="caption"
                        sx={{ fontWeight: 800, color: marsTokens.marsPetcareRed }}
                      >
                        Failed
                      </Typography>
                    </>
                  ) : (
                    <>
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: marsTokens.lightGray,
                          flexShrink: 0,
                        }}
                      />
                      <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.secondary' }}>
                        Idle
                      </Typography>
                    </>
                  )}
                </Box>

                {agent.tools.length > 0 && (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, minWidth: 0 }}>
                    {agent.tools.map((tool) => (
                      <Typography
                        key={tool}
                        variant="caption"
                        sx={{
                          px: 0.625,
                          py: 0.125,
                          borderRadius: 0.75,
                          bgcolor: 'rgba(0,0,32,0.045)',
                          border: '1px solid rgba(0,0,32,0.08)',
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 600,
                          color: '#4A4A58',
                          ...breakAnywhere,
                        }}
                      >
                        {tool}
                      </Typography>
                    ))}
                  </Box>
                )}
              </Box>

              {own.length > 0 ? (
                <Box sx={{ ...stackGrid, pl: 0.75 }}>
                  {own.map((step, stepIndex) => (
                    <AgentStepRow
                      key={step.seq}
                      step={step}
                      isLast={stepIndex === own.length - 1}
                      animate={step.seq > animateAboveSeq}
                    />
                  ))}
                </Box>
              ) : (
                <Typography variant="caption" sx={{ pl: 0.75, color: 'text.disabled' }}>
                  No steps yet.
                </Typography>
              )}
            </Box>
          );
        })}
      </Box>

      <Box
        sx={{
          px: 2,
          py: 1.5,
          borderTop: '1px solid rgba(0,0,32,0.08)',
          bgcolor: '#FAFAFC',
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          flexWrap: 'wrap',
        }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            sx={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.875rem',
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1.2,
            }}
          >
            {formatMs(totalElapsed)}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {steps.length} {steps.length === 1 ? 'step' : 'steps'} · pipeline elapsed
          </Typography>
        </Box>
        <Button
          size="small"
          variant="outlined"
          startIcon={<ReplayRoundedIcon sx={{ fontSize: 16 }} />}
          disabled={steps.length === 0 || replaying}
          onClick={() => setReplayCount(0)}
          sx={{ flexShrink: 0 }}
        >
          {replaying ? 'Replaying' : 'Replay'}
        </Button>
      </Box>
    </Box>
  );
}
