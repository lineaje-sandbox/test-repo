import { Box, Paper, Skeleton, Typography } from '@mui/material';
import type { SvgIconComponent } from '@mui/icons-material';
import type { OrderException } from '../api/types';
import { marsTokens } from '../theme/marsTheme';
import { breakAnywhere, stackGrid } from '../theme/layout';
import { DASH } from '../utils/format';
import { ExceptionCard } from './ExceptionCard';

export interface ExtractedField {
  /** The contract path, so an exception on the same path renders beside it. */
  key: string;
  label: string;
  value: string | null;
  mono?: boolean;
  /** Spans both columns; use for long names and addresses. */
  wide?: boolean;
}

interface ExtractedFieldCardProps {
  title: string;
  icon: SvgIconComponent;
  fields: ExtractedField[];
  exceptions: OrderException[];
  /** True while the extraction agent is still working and values have not landed. */
  pending: boolean;
  onResolve: (exception: OrderException, value: string) => void | Promise<void>;
  busyField: string | null;
}

export function ExtractedFieldCard({
  title,
  icon: Icon,
  fields,
  exceptions,
  pending,
  onResolve,
  busyField,
}: ExtractedFieldCardProps) {
  const own = exceptions.filter(
    (item) => !item.resolved && fields.some((field) => field.key === item.field),
  );

  return (
    <Paper sx={{ borderRadius: 2.5, p: 2, minWidth: 0, ...stackGrid, gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Icon sx={{ fontSize: 17, color: marsTokens.marsBlue, flexShrink: 0 }} />
        <Typography variant="h6" sx={{ color: 'text.secondary', minWidth: 0 }}>
          {title}
        </Typography>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' },
          columnGap: 2,
          rowGap: 1.375,
        }}
      >
        {fields.map((field) => {
          const exception = own.find((item) => item.field === field.key) ?? null;
          return (
            <Box
              key={field.key}
              sx={{
                minWidth: 0,
                ...(field.wide || exception !== null ? { gridColumn: { xs: 'auto', sm: '1 / -1' } } : {}),
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  color: 'text.secondary',
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  fontWeight: 700,
                }}
              >
                {field.label}
              </Typography>
              {pending && field.value === null ? (
                <Skeleton width="72%" height={20} />
              ) : (
                <Typography
                  sx={{
                    fontSize: '0.875rem',
                    fontWeight: field.mono ? 600 : 500,
                    lineHeight: 1.4,
                    color: field.value === null ? 'text.disabled' : marsTokens.darkGrey,
                    ...(field.mono ? { fontFamily: 'var(--font-mono)' } : {}),
                    ...breakAnywhere,
                  }}
                >
                  {field.value ?? DASH}
                </Typography>
              )}
              {exception !== null && (
                <Box sx={{ mt: 1 }}>
                  <ExceptionCard
                    exception={exception}
                    onResolve={onResolve}
                    busy={busyField === exception.field}
                  />
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
}
