import { Box, Typography } from '@mui/material';
import type { OrderStatus } from '../api/types';
import { marsTokens, statusColor } from '../theme/marsTheme';

const LABELS: Record<OrderStatus, string> = {
  RECEIVED: 'Received',
  EXTRACTING: 'Extracting',
  VALIDATING: 'Validating',
  READY: 'Ready',
  EXCEPTION: 'Exception',
  APPROVED: 'Approved',
  FAILED: 'Failed',
};

const IN_FLIGHT: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'RECEIVED',
  'EXTRACTING',
  'VALIDATING',
]);

interface StatusPillProps {
  status: OrderStatus;
  dense?: boolean;
}

export function StatusPill({ status, dense = false }: StatusPillProps) {
  const color = statusColor[status];
  const live = IN_FLIGHT.has(status);

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        px: dense ? 0.875 : 1.125,
        py: dense ? 0.25 : 0.4375,
        borderRadius: 999,
        border: `1px solid ${color}55`,
        bgcolor: `${color}14`,
        whiteSpace: 'nowrap',
        maxWidth: '100%',
      }}
    >
      <Box sx={{ position: 'relative', width: 7, height: 7, flexShrink: 0 }}>
        {live && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              bgcolor: color,
              animation: 'mars-pulse 1.8s ease-out infinite',
            }}
          />
        )}
        <Box sx={{ position: 'absolute', inset: 0, borderRadius: '50%', bgcolor: color }} />
      </Box>
      <Typography
        variant="caption"
        sx={{
          fontWeight: 800,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: marsTokens.darkGrey,
          lineHeight: 1.4,
        }}
      >
        {LABELS[status]}
      </Typography>
    </Box>
  );
}
