import { useState } from 'react';
import { Box, Button, CircularProgress, TextField, Tooltip, Typography } from '@mui/material';
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import type { ExceptionKind, OrderException } from '../api/types';
import { marsTokens, severityColor } from '../theme/marsTheme';
import { breakAnywhere, stackGrid } from '../theme/layout';
import { fieldLabel, formatPct } from '../utils/format';

const KIND_LABEL: Record<ExceptionKind, string> = {
  UNKNOWN_MARKT: 'Unknown store number',
  UNMAPPED_ITEM: 'Unmapped item',
  AMBIGUOUS_ITEM: 'Ambiguous item',
  TOTALS_MISMATCH: 'Totals mismatch',
  VAT_ID_INVALID: 'Invalid VAT ID',
  MISSING_FIELD: 'Missing field',
};

interface ExceptionCardProps {
  exception: OrderException;
  onResolve: (exception: OrderException, value: string) => void | Promise<void>;
  busy?: boolean;
  /** `queue` adds the field heading used on the exceptions page. */
  variant?: 'inline' | 'queue';
}

export function ExceptionCard({
  exception,
  onResolve,
  busy = false,
  variant = 'inline',
}: ExceptionCardProps) {
  const [draft, setDraft] = useState('');
  const accent = severityColor[exception.severity];
  const SeverityIcon = exception.severity === 'BLOCKING' ? ErrorRoundedIcon : WarningAmberRoundedIcon;
  const hasSuggestion = exception.suggestion !== null && exception.suggestion.length > 0;

  if (exception.resolved) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 1,
          px: 1.5,
          py: 1.125,
          borderRadius: 1.5,
          border: `1px solid ${marsTokens.marsGreen}44`,
          bgcolor: `${marsTokens.marsGreen}0F`,
          minWidth: 0,
        }}
      >
        <CheckCircleRoundedIcon sx={{ fontSize: 16, color: marsTokens.marsGreen, mt: 0.125, flexShrink: 0 }} />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 700, ...breakAnywhere }}>
            Resolved — {fieldLabel(exception.field)} set to {exception.resolved_value ?? 'a new value'}
          </Typography>
          {exception.resolved_by !== null && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              by {exception.resolved_by}
            </Typography>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        ...stackGrid,
        gap: 1.125,
        px: 1.5,
        py: 1.375,
        borderRadius: 1.5,
        border: `1px solid ${accent}3D`,
        borderLeft: `3px solid ${accent}`,
        bgcolor: `${accent}0D`,
        minWidth: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.875, flexWrap: 'wrap', minWidth: 0 }}>
        <SeverityIcon sx={{ fontSize: 16, color: accent, flexShrink: 0 }} />
        <Typography
          variant="caption"
          sx={{ fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: accent }}
        >
          {KIND_LABEL[exception.kind]}
        </Typography>
        <Typography
          variant="caption"
          sx={{
            px: 0.625,
            borderRadius: 0.75,
            bgcolor: 'rgba(0,0,32,0.06)',
            color: 'text.secondary',
            fontWeight: 800,
            letterSpacing: '0.05em',
          }}
        >
          {exception.severity}
        </Typography>
        {variant === 'queue' && (
          <Typography
            variant="caption"
            sx={{ ml: 'auto', color: 'text.secondary', fontFamily: 'var(--font-mono)', ...breakAnywhere }}
          >
            {exception.field}
          </Typography>
        )}
      </Box>

      <Typography variant="body2" sx={{ ...breakAnywhere }}>
        {exception.message}
      </Typography>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, minWidth: 0 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            Field
          </Typography>
          <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, ...breakAnywhere }}>
            {fieldLabel(exception.field)}
          </Typography>
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            Observed
          </Typography>
          <Typography
            sx={{
              fontSize: '0.8125rem',
              fontWeight: 700,
              fontFamily: 'var(--font-mono)',
              color: accent,
              ...breakAnywhere,
            }}
          >
            {exception.observed ?? '—'}
          </Typography>
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            Expected
          </Typography>
          <Typography sx={{ fontSize: '0.8125rem', ...breakAnywhere }}>
            {exception.expected ?? '—'}
          </Typography>
        </Box>
      </Box>

      {hasSuggestion && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            flexWrap: 'wrap',
            p: 1,
            borderRadius: 1.25,
            bgcolor: marsTokens.white,
            border: '1px solid rgba(0,0,32,0.09)',
            minWidth: 0,
          }}
        >
          <AutoFixHighRoundedIcon sx={{ fontSize: 16, color: marsTokens.marsBlue, flexShrink: 0 }} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, ...breakAnywhere }}>
              {exception.suggestion_label ?? exception.suggestion}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Agent suggestion
              {exception.suggestion_confidence !== null
                ? ` · ${formatPct(exception.suggestion_confidence * 100, 0)} confidence`
                : ''}
              {exception.auto_resolvable ? ' · safe to auto-apply' : ''}
            </Typography>
          </Box>
          <Button
            size="small"
            variant="contained"
            disabled={busy}
            startIcon={busy ? <CircularProgress size={13} color="inherit" /> : undefined}
            onClick={() => void onResolve(exception, exception.suggestion ?? '')}
            sx={{ flexShrink: 0 }}
          >
            Apply suggestion
          </Button>
        </Box>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minWidth: 0 }}>
        <TextField
          size="small"
          placeholder={hasSuggestion ? 'Or enter a different value' : 'Enter the correct value'}
          value={draft}
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draft.trim().length > 0 && !busy) {
              void onResolve(exception, draft.trim());
            }
          }}
          sx={{ flex: 1, minWidth: 180 }}
          inputProps={{ 'aria-label': `New value for ${fieldLabel(exception.field)}` }}
        />
        <Tooltip title={draft.trim().length === 0 ? 'Enter a value first' : 'Save and revalidate'}>
          <span>
            <Button
              size="small"
              variant="outlined"
              disabled={busy || draft.trim().length === 0}
              onClick={() => void onResolve(exception, draft.trim())}
            >
              Save
            </Button>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}
