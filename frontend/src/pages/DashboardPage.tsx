import { useMemo } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Paper, Typography } from '@mui/material';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined';
import { Area, AreaChart, ResponsiveContainer, Tooltip as ChartTooltip, YAxis } from 'recharts';
import type { AppConfig, OrderSummary } from '../api/types';
import { marsTokens } from '../theme/marsTheme';
import { breakAnywhere, stackGrid } from '../theme/layout';
import { DASH, formatClock, formatCount } from '../utils/format';
import { KpiStrip } from '../components/KpiStrip';
import { OrderTable } from '../components/OrderTable';

interface DashboardPageProps {
  config: AppConfig | null;
  orders: OrderSummary[];
  ordersLoading: boolean;
  activeOrderId: string | null;
  onUpload: () => void;
  onSelectOrder: (orderId: string) => void;
}

interface SparkPoint {
  label: string;
  orders: number;
}

/** Cumulative orders against arrival order, so the shape reads correctly even with three points. */
function buildSpark(orders: OrderSummary[]): SparkPoint[] {
  const ascending = [...orders].sort((a, b) => a.received_at.localeCompare(b.received_at));
  const points: SparkPoint[] = [{ label: 'session start', orders: 0 }];
  ascending.forEach((order, index) => {
    points.push({ label: formatClock(order.received_at), orders: index + 1 });
  });
  return points;
}

function ComplianceItem({ label, value }: { label: string; value: string | null }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        variant="caption"
        sx={{
          display: 'block',
          color: 'text.secondary',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontWeight: 700,
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          fontSize: '0.8125rem',
          fontWeight: 700,
          fontFamily: 'var(--font-mono)',
          lineHeight: 1.45,
          color: value === null ? 'text.disabled' : marsTokens.darkGrey,
          ...breakAnywhere,
        }}
      >
        {value ?? DASH}
      </Typography>
    </Box>
  );
}

export function DashboardPage({
  config,
  orders,
  ordersLoading,
  activeOrderId,
  onUpload,
  onSelectOrder,
}: DashboardPageProps) {
  const spark = useMemo(() => buildSpark(orders), [orders]);
  const hasData = orders.length > 0;

  return (
    <Box sx={{ ...stackGrid, gap: 3 }}>
      {/* Full-bleed hero, bleeding to the edge of the content column via negative margin. */}
      <Box
        sx={{
          mx: { xs: -2, md: -3 },
          mt: { xs: -2.5, md: -3 },
          px: { xs: 3, md: 6 },
          py: { xs: 4.5, md: 6.5 },
          position: 'relative',
          overflow: 'hidden',
          color: marsTokens.white,
          background: `linear-gradient(118deg, ${marsTokens.marsBlue} 0%, #0007B4 46%, ${marsTokens.marsEdge} 118%)`,
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            opacity: 0.2,
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.28) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.28) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
            maskImage: 'radial-gradient(120% 90% at 82% 18%, #000 12%, transparent 72%)',
            WebkitMaskImage: 'radial-gradient(120% 90% at 82% 18%, #000 12%, transparent 72%)',
          }}
        />
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            top: -120,
            right: -80,
            width: 420,
            height: 420,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${marsTokens.skyBlue}3D 0%, transparent 62%)`,
            pointerEvents: 'none',
          }}
        />

        <Box sx={{ position: 'relative', maxWidth: 780, minWidth: 0 }}>
          <Typography
            variant="h6"
            sx={{ color: marsTokens.skyBlue, letterSpacing: '0.16em', mb: 1.5, ...breakAnywhere }}
          >
            Royal Canin CNE · Agentic order processing
          </Typography>
          <Typography
            sx={{
              fontSize: { xs: '1.875rem', sm: '2.375rem', md: '3rem' },
              fontWeight: 800,
              letterSpacing: '-0.03em',
              lineHeight: 1.06,
              color: marsTokens.white,
              ...breakAnywhere,
            }}
          >
            Thousands of order PDFs a year, read and reconciled without a template.
          </Typography>
          <Typography
            sx={{
              mt: 2.25,
              fontSize: { xs: '0.9375rem', md: '1.0625rem' },
              lineHeight: 1.6,
              color: 'rgba(255,255,255,0.9)',
              maxWidth: 660,
            }}
          >
            Two Gemini agents on Google ADK take over the Automation Anywhere and OCR chain. One reads the
            document, the other reconciles it against master data and recomputes the money in Python — and
            only the genuine exceptions reach your queue.
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5, mt: 3.5, flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              size="large"
              onClick={onUpload}
              startIcon={<FileUploadOutlinedIcon />}
              sx={{
                bgcolor: marsTokens.white,
                color: marsTokens.marsBlue,
                px: 3,
                '&:hover': { bgcolor: 'rgba(255,255,255,0.9)' },
              }}
            >
              Upload an order
            </Button>
            <Button
              component={RouterLink}
              to="/exceptions"
              endIcon={<ArrowForwardRoundedIcon sx={{ fontSize: 18 }} />}
              sx={{
                color: marsTokens.white,
                px: 0,
                textDecoration: 'underline',
                textUnderlineOffset: '4px',
                '&:hover': { bgcolor: 'transparent', color: marsTokens.skyBlue },
              }}
            >
              Open the exception queue
            </Button>
          </Box>
        </Box>
      </Box>

      <KpiStrip orders={orders} loading={ordersLoading} />

      <Paper sx={{ borderRadius: 3, p: 2.25, minWidth: 0, ...stackGrid, gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap', minWidth: 0 }}>
          <Typography variant="h6" sx={{ color: 'text.secondary', minWidth: 0 }}>
            Orders this session
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {hasData
              ? `${formatCount(orders.length)} documents, newest at ${formatClock(orders[0]?.received_at ?? null)}`
              : 'The line starts as soon as the first document arrives'}
          </Typography>
        </Box>
        <Box sx={{ width: '100%', height: 96, minWidth: 0 }}>
          {hasData ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={spark} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={marsTokens.marsBlue} stopOpacity={0.38} />
                    <stop offset="100%" stopColor={marsTokens.marsBlue} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <YAxis hide domain={[0, 'dataMax + 1']} />
                <ChartTooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: '1px solid rgba(0,0,32,0.1)',
                    fontSize: 12,
                    fontFamily: 'var(--font-stack)',
                  }}
                  labelFormatter={(label: string) => `at ${label}`}
                  formatter={(value: number) => [`${value}`, 'orders']}
                />
                <Area
                  type="monotone"
                  dataKey="orders"
                  stroke={marsTokens.marsBlue}
                  strokeWidth={2}
                  fill="url(#spark-fill)"
                  // a demo session has only a handful of points, and a bare line
                  // between two of them does not read as data without the markers
                  dot={spark.length <= 8 ? { r: 3, fill: marsTokens.marsBlue, strokeWidth: 0 } : false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}>
              <Typography variant="body2" sx={{ color: 'text.disabled' }}>
                No throughput to plot yet.
              </Typography>
            </Box>
          )}
        </Box>
      </Paper>

      <Box sx={{ ...stackGrid, gap: 1.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h4">Recent orders</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Newest first · select a row to open the workbench beside the original document
          </Typography>
        </Box>
        <OrderTable
          orders={orders}
          loading={ordersLoading}
          activeOrderId={activeOrderId}
          onSelect={onSelectOrder}
        />
      </Box>

      <Paper sx={{ borderRadius: 3, p: 2.5, minWidth: 0, ...stackGrid, gap: 2 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" sx={{ color: 'text.secondary' }}>
            Residency & compliance
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
            Read live from the service configuration on every page load.
          </Typography>
        </Box>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(210px, 100%), 1fr))',
            gap: 2,
          }}
        >
          <ComplianceItem
            label="Agent runtime"
            value={
              config === null
                ? null
                : config.agent_engine_location.length > 0
                  ? `${config.agent_runtime} · ${config.agent_engine_location}`
                  : config.agent_runtime
            }
          />
          <ComplianceItem
            label="API runtime"
            value={
              config === null ? null : `${config.api_runtime} · ${config.service_region}`
            }
          />
          <ComplianceItem label="Model endpoint" value={config?.endpoint_location ?? null} />
          <ComplianceItem
            label="Document storage"
            value={
              config === null
                ? null
                : config.document_bucket.length > 0
                  ? `${config.document_bucket} · ${config.document_bucket_location}`
                  : 'Local disk (not deployed)'
            }
          />
          <ComplianceItem label="Google ADK version" value={config?.adk_version ?? null} />
          <ComplianceItem label="Master-data source" value={config?.masterdata.source ?? null} />
        </Box>

        <Box
          sx={{
            p: 1.5,
            borderRadius: 1.5,
            bgcolor: 'rgba(0,0,160,0.035)',
            border: '1px solid rgba(0,0,160,0.10)',
            minWidth: 0,
          }}
        >
          <Typography variant="body2" sx={{ color: marsTokens.darkGrey, ...breakAnywhere }}>
            {config?.residency_note ??
              'Residency note unavailable — the configuration endpoint has not responded.'}
          </Typography>
          {config !== null && (
            <Typography variant="caption" sx={{ display: 'block', mt: 0.75, color: 'text.secondary' }}>
              Project {config.project_id} · master data holds {formatCount(config.masterdata.clients)}{' '}
              clients and {formatCount(config.masterdata.items)} items
              {config.masterdata.simulated ? ' (simulated seed)' : ''}
            </Typography>
          )}
        </Box>

        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
            Not wired to production systems in this demo:
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.875, minWidth: 0 }}>
            {(config?.simulated_integrations ?? []).map((item) => (
              <Box
                key={item}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.625,
                  px: 1,
                  py: 0.375,
                  borderRadius: 999,
                  border: '1px solid rgba(0,0,32,0.14)',
                  bgcolor: '#FAFAFC',
                  maxWidth: '100%',
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    px: 0.5,
                    borderRadius: 0.5,
                    bgcolor: marsTokens.marsWrigley,
                    color: marsTokens.white,
                    fontWeight: 800,
                    letterSpacing: '0.06em',
                    flexShrink: 0,
                  }}
                >
                  SIMULATED
                </Typography>
                <Typography variant="caption" sx={{ color: marsTokens.darkGrey, ...breakAnywhere }}>
                  {item}
                </Typography>
              </Box>
            ))}
            {(config?.simulated_integrations ?? []).length === 0 && (
              <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                {DASH}
              </Typography>
            )}
          </Box>
        </Box>
      </Paper>
    </Box>
  );
}
