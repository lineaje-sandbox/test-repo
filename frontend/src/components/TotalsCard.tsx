import { Box, Paper, Skeleton, Tooltip, Typography } from '@mui/material';
import CalculateOutlinedIcon from '@mui/icons-material/CalculateOutlined';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import CancelRoundedIcon from '@mui/icons-material/CancelRounded';
import type { OrderException, TotalsCheck } from '../api/types';
import { marsTokens } from '../theme/marsTheme';
import { breakAnywhere, stackGrid } from '../theme/layout';
import { DASH, formatMoney, formatPct } from '../utils/format';
import { ExceptionCard } from './ExceptionCard';

interface TotalsRow {
  key: string;
  label: string;
  stated: number | null;
  recomputed: number | null;
}

interface TotalsCardProps {
  totals: TotalsCheck | null;
  currency: string | null;
  vatRatePct: number | null;
  exceptions: OrderException[];
  pending: boolean;
  onResolve: (exception: OrderException, value: string) => void | Promise<void>;
  busyField: string | null;
}

export function TotalsCard({
  totals,
  currency,
  vatRatePct,
  exceptions,
  pending,
  onResolve,
  busyField,
}: TotalsCardProps) {
  const rows: TotalsRow[] = [
    { key: 'net', label: 'Net', stated: totals?.net_stated ?? null, recomputed: totals?.net_recomputed ?? null },
    {
      key: 'vat',
      label: vatRatePct !== null ? `VAT (${formatPct(vatRatePct, 0)})` : 'VAT',
      stated: totals?.vat_stated ?? null,
      recomputed: totals?.vat_recomputed ?? null,
    },
    {
      key: 'total',
      label: 'Total',
      stated: totals?.total_stated ?? null,
      recomputed: totals?.total_recomputed ?? null,
    },
  ];

  const matches = totals?.matches_document ?? null;
  const accent =
    matches === null ? marsTokens.lightGray : matches ? marsTokens.marsGreen : marsTokens.marsPetcareRed;
  const totalsExceptions = exceptions.filter(
    (item) => !item.resolved && (item.kind === 'TOTALS_MISMATCH' || item.field.startsWith('totals')),
  );

  const rowDelta = (row: TotalsRow): number | null => {
    if (row.stated === null || row.recomputed === null) return null;
    return Math.round((row.recomputed - row.stated) * 100) / 100;
  };

  return (
    <Paper sx={{ borderRadius: 2.5, p: 2, minWidth: 0, ...stackGrid, gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <CalculateOutlinedIcon sx={{ fontSize: 17, color: marsTokens.marsBlue, flexShrink: 0 }} />
        <Typography variant="h6" sx={{ color: 'text.secondary', flex: 1, minWidth: 0 }}>
          Totals reconciliation
        </Typography>
        {matches !== null && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
            {matches ? (
              <CheckCircleRoundedIcon sx={{ fontSize: 17, color: marsTokens.marsGreen }} />
            ) : (
              <CancelRoundedIcon sx={{ fontSize: 17, color: marsTokens.marsPetcareRed }} />
            )}
            <Typography variant="caption" sx={{ fontWeight: 800, color: accent }}>
              {matches ? 'Agrees with the document' : 'Does not agree'}
            </Typography>
          </Box>
        )}
      </Box>

      {totals === null ? (
        pending ? (
          <Box>
            <Skeleton height={24} />
            <Skeleton height={24} width="80%" />
            <Skeleton height={24} width="60%" />
          </Box>
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Totals are recomputed once the reconciliation agent runs.
          </Typography>
        )
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1fr) auto',
            columnGap: 1.5,
            rowGap: 0.875,
            alignItems: 'center',
          }}
        >
          <Box />
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textAlign: 'right' }}>
            STATED
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, textAlign: 'right' }}>
            RECOMPUTED
          </Typography>
          <Box sx={{ width: 18 }} />

          {rows.map((row) => {
            const delta = rowDelta(row);
            const ok = delta !== null && Math.abs(delta) <= (totals.tolerance ?? 0.01);
            const emphasised = row.key === 'total';
            return (
              <Box key={row.key} sx={{ display: 'contents' }}>
                <Typography
                  sx={{
                    fontSize: emphasised ? '0.9375rem' : '0.8125rem',
                    fontWeight: emphasised ? 800 : 600,
                    minWidth: 0,
                    ...breakAnywhere,
                  }}
                >
                  {row.label}
                </Typography>
                <Typography
                  sx={{
                    textAlign: 'right',
                    fontFamily: 'var(--font-mono)',
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: emphasised ? '0.9375rem' : '0.8125rem',
                    color: row.stated === null ? 'text.disabled' : 'text.secondary',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.stated === null ? DASH : formatMoney(row.stated)}
                </Typography>
                <Typography
                  sx={{
                    textAlign: 'right',
                    fontFamily: 'var(--font-mono)',
                    fontVariantNumeric: 'tabular-nums',
                    fontSize: emphasised ? '0.9375rem' : '0.8125rem',
                    fontWeight: emphasised ? 800 : 700,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatMoney(row.recomputed)}
                </Typography>
                <Box sx={{ width: 18, display: 'grid', placeItems: 'center' }}>
                  {delta === null ? (
                    <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                      {DASH}
                    </Typography>
                  ) : (
                    <Tooltip
                      title={
                        ok
                          ? `Within the ${totals.tolerance.toFixed(2)} tolerance.`
                          : `Off by ${delta.toFixed(2)} against the printed figure.`
                      }
                    >
                      {ok ? (
                        <CheckCircleRoundedIcon sx={{ fontSize: 16, color: marsTokens.marsGreen }} />
                      ) : (
                        <CancelRoundedIcon sx={{ fontSize: 16, color: marsTokens.marsPetcareRed }} />
                      )}
                    </Tooltip>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      <Typography variant="caption" sx={{ color: 'text.secondary', ...breakAnywhere }}>
        Recomputed in Python, not by the model{currency ? ` · amounts in ${currency}` : ''}.
      </Typography>

      {totalsExceptions.map((exception) => (
        <ExceptionCard
          key={`${exception.kind}-${exception.field}`}
          exception={exception}
          onResolve={onResolve}
          busy={busyField === exception.field}
        />
      ))}
    </Paper>
  );
}
