import { Box, Tooltip, Typography } from '@mui/material';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import DataObjectRoundedIcon from '@mui/icons-material/DataObjectRounded';
import CallSplitRoundedIcon from '@mui/icons-material/CallSplitRounded';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import type { SvgIconComponent } from '@mui/icons-material';
import type { AgentStep, StepKind } from '../api/types';
import { marsTokens, stepStatusColor } from '../theme/marsTheme';
import { breakAnywhere } from '../theme/layout';
import { formatMs } from '../utils/format';

const KIND_ICON: Record<StepKind, SvgIconComponent> = {
  MODEL_CALL: AutoAwesomeRoundedIcon,
  TOOL_CALL: DataObjectRoundedIcon,
  DECISION: CallSplitRoundedIcon,
  IO: DescriptionOutlinedIcon,
};

const KIND_COLOR: Record<StepKind, string> = {
  MODEL_CALL: marsTokens.marsBlue,
  TOOL_CALL: marsTokens.marsEdge,
  DECISION: marsTokens.marsWrigley,
  IO: marsTokens.lightGray,
};

const KIND_TOOLTIP: Record<StepKind, string> = {
  MODEL_CALL: 'Gemini model call — judgement, reading and adjudication',
  TOOL_CALL: 'Deterministic Python tool — lookups and arithmetic, no model involved',
  DECISION: 'Control-flow decision taken by the agent',
  IO: 'Document or file input/output',
};

interface ModelChipProps {
  model: string;
  /** flash / pro, shown as a suffix badge when supplied. */
  tier?: string | null;
  size?: 'sm' | 'md';
}

/** The model identifier is the point of the rail, so it always renders monospace. */
export function ModelChip({ model, tier, size = 'sm' }: ModelChipProps) {
  const md = size === 'md';
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.625,
        maxWidth: '100%',
        px: md ? 1 : 0.75,
        py: md ? 0.5 : 0.25,
        borderRadius: 1,
        border: `1px solid ${marsTokens.marsBlue}33`,
        bgcolor: `${marsTokens.marsBlue}0F`,
      }}
    >
      <AutoAwesomeRoundedIcon
        sx={{ fontSize: md ? 14 : 12, color: marsTokens.marsBlue, flexShrink: 0 }}
      />
      <Typography
        sx={{
          fontFamily: 'var(--font-mono)',
          fontSize: md ? '0.75rem' : '0.6875rem',
          fontWeight: 600,
          color: marsTokens.marsBlue,
          lineHeight: 1.35,
          ...breakAnywhere,
        }}
      >
        {model}
      </Typography>
      {tier ? (
        <Typography
          sx={{
            flexShrink: 0,
            px: 0.5,
            borderRadius: 0.5,
            bgcolor: marsTokens.marsBlue,
            color: marsTokens.white,
            fontSize: '0.5625rem',
            fontWeight: 800,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            lineHeight: 1.6,
          }}
        >
          {tier}
        </Typography>
      ) : null}
    </Box>
  );
}

function ToolChip({ tool }: { tool: string }) {
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        maxWidth: '100%',
        px: 0.75,
        py: 0.25,
        borderRadius: 1,
        border: '1px solid rgba(0,0,32,0.12)',
        bgcolor: 'rgba(0,0,32,0.04)',
      }}
    >
      <DataObjectRoundedIcon sx={{ fontSize: 12, color: marsTokens.marsEdge, flexShrink: 0 }} />
      <Typography
        sx={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.6875rem',
          fontWeight: 600,
          color: '#4A4A58',
          lineHeight: 1.35,
          ...breakAnywhere,
        }}
      >
        {tool}()
      </Typography>
    </Box>
  );
}

interface AgentStepRowProps {
  step: AgentStep;
  /** Suppresses the connector below the final row of an agent's timeline. */
  isLast: boolean;
  animate?: boolean;
}

export function AgentStepRow({ step, isLast, animate = false }: AgentStepRowProps) {
  const Icon = KIND_ICON[step.kind];
  const kindColor = KIND_COLOR[step.kind];
  const statusTint = stepStatusColor[step.status];
  const running = step.status === 'RUNNING';
  const failed = step.status === 'FAILED';
  const accent = failed ? marsTokens.marsPetcareRed : running ? marsTokens.marsEdge : kindColor;
  const showTokens = step.tokens_in !== null || step.tokens_out !== null;

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: '22px minmax(0, 1fr)',
        columnGap: 1.25,
        ...(animate ? { animation: 'mars-fade-up 260ms ease-out both' } : {}),
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0 }}>
        <Tooltip title={KIND_TOOLTIP[step.kind]} placement="left">
          <Box
            sx={{
              position: 'relative',
              width: 22,
              height: 22,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              border: `1px solid ${accent}4D`,
              bgcolor: `${accent}12`,
              ...(running ? { animation: 'mars-breathe 1.4s ease-in-out infinite' } : {}),
            }}
          >
            <Icon sx={{ fontSize: 13, color: accent }} />
          </Box>
        </Tooltip>
        {!isLast && (
          <Box sx={{ flex: 1, width: 1, minHeight: 10, bgcolor: 'rgba(0,0,32,0.10)', mt: 0.5 }} />
        )}
      </Box>

      <Box sx={{ minWidth: 0, pb: isLast ? 0 : 1.75 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
          <Typography
            sx={{
              flex: 1,
              minWidth: 0,
              fontSize: '0.8125rem',
              fontWeight: 700,
              lineHeight: 1.35,
              color: failed ? marsTokens.marsPetcareRed : marsTokens.darkGrey,
              ...breakAnywhere,
            }}
          >
            {step.label}
          </Typography>
          <Typography
            variant="caption"
            sx={{
              flexShrink: 0,
              fontFamily: 'var(--font-mono)',
              fontVariantNumeric: 'tabular-nums',
              color: running ? marsTokens.marsEdge : 'text.secondary',
              fontWeight: 600,
            }}
          >
            {running ? 'running' : formatMs(step.elapsed_ms)}
          </Typography>
        </Box>

        {step.detail !== null && step.detail.length > 0 && (
          <Typography
            variant="body2"
            sx={{ mt: 0.25, color: 'text.secondary', fontSize: '0.75rem', ...breakAnywhere }}
          >
            {step.detail}
          </Typography>
        )}

        {(step.kind === 'MODEL_CALL' || step.tool !== null) && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.625, mt: 0.625, minWidth: 0 }}>
            {/* A MODEL_CALL always names its model; a TOOL_CALL never does. */}
            {step.kind === 'MODEL_CALL' && step.model !== null && <ModelChip model={step.model} />}
            {step.kind !== 'MODEL_CALL' && step.tool !== null && <ToolChip tool={step.tool} />}
          </Box>
        )}

        {showTokens && (
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              mt: 0.5,
              color: 'text.secondary',
              fontFamily: 'var(--font-mono)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {step.tokens_in !== null ? `${step.tokens_in.toLocaleString('en-GB')} in` : '— in'}
            {' · '}
            {step.tokens_out !== null ? `${step.tokens_out.toLocaleString('en-GB')} out` : '— out'}
            {' tokens'}
          </Typography>
        )}

        {failed && (
          <Typography
            variant="caption"
            sx={{ display: 'block', mt: 0.5, color: statusTint, fontWeight: 700 }}
          >
            Step failed
          </Typography>
        )}
      </Box>
    </Box>
  );
}
