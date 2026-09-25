import { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { formatMs, msSince } from '../utils/format';

interface ElapsedTimerProps {
  /** ISO timestamp the run started at; drives the live tick. */
  startedAt?: string | null;
  /** Settled duration to render once the run is no longer in flight. */
  valueMs?: number | null;
  running: boolean;
  monospace?: boolean;
}

/**
 * Renders a duration, ticking only while the run is in flight. The interval is
 * torn down the moment `running` goes false so finished rows cost nothing.
 */
export function ElapsedTimer({
  startedAt,
  valueMs,
  running,
  monospace = true,
}: ElapsedTimerProps) {
  const [tick, setTick] = useState(() => msSince(startedAt));

  useEffect(() => {
    if (!running) return undefined;
    setTick(msSince(startedAt));
    const timer = window.setInterval(() => setTick(msSince(startedAt)), 200);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);

  const shown = running ? tick : (valueMs ?? null);

  return (
    <Box
      component="span"
      sx={{
        fontFamily: monospace ? 'var(--font-mono)' : 'inherit',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}
    >
      {formatMs(shown)}
    </Box>
  );
}
