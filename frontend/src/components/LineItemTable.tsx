import { Fragment } from 'react';
import { Box, Paper, Skeleton, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from '@mui/material';
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined';
import type { ExtractedLine, MatchMethod, OrderException, ValidatedLine } from '../api/types';
import { classificationColor, marsTokens, matchMethodColor } from '../theme/marsTheme';
import { breakAnywhere, scrollX, stackGrid } from '../theme/layout';
import { DASH, formatMoney, formatQty } from '../utils/format';
import { ExceptionCard } from './ExceptionCard';

const MATCH_TOOLTIP: Record<MatchMethod, string> = {
  EXACT: 'Supplier item number matched the item list exactly.',
  FUZZY: 'Matched on a near-identical candidate; confidence below 1.0.',
  HUMAN: 'Set by a customer service specialist during review.',
  NONE: 'No Minos mapping found. This line cannot be fulfilled as printed.',
};

function Pill({ label, color, title }: { label: string; color: string; title?: string }) {
  const content = (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: 0.75,
        py: 0.1875,
        borderRadius: 0.875,
        border: `1px solid ${color}55`,
        bgcolor: `${color}14`,
        whiteSpace: 'nowrap',
      }}
    >
      <Typography
        variant="caption"
        sx={{ fontWeight: 800, letterSpacing: '0.06em', color: marsTokens.darkGrey }}
      >
        {label}
      </Typography>
    </Box>
  );
  return title === undefined ? content : <Tooltip title={title}>{content}</Tooltip>;
}

interface LineItemTableProps {
  extractedLines: ExtractedLine[];
  validatedLines: ValidatedLine[];
  exceptions: OrderException[];
  currency: string | null;
  /** True while agent 1 is still reading the document. */
  pending: boolean;
  onResolve: (exception: OrderException, value: string) => void | Promise<void>;
  busyField: string | null;
}

export function LineItemTable({
  extractedLines,
  validatedLines,
  exceptions,
  currency,
  pending,
  onResolve,
  busyField,
}: LineItemTableProps) {
  // Extraction lands before reconciliation, so the table is driven by the extracted
  // rows and enriched with the validated view as soon as agent 2 reports.
  const rowCount = Math.max(extractedLines.length, validatedLines.length);
  const openExceptions = exceptions.filter((item) => !item.resolved && item.line_index !== null);

  return (
    <Paper sx={{ borderRadius: 2.5, minWidth: 0, overflow: 'hidden', ...stackGrid }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          py: 1.5,
          borderBottom: '1px solid rgba(0,0,32,0.07)',
          minWidth: 0,
        }}
      >
        <Inventory2OutlinedIcon sx={{ fontSize: 17, color: marsTokens.marsBlue, flexShrink: 0 }} />
        <Typography variant="h6" sx={{ color: 'text.secondary', flex: 1, minWidth: 0 }}>
          Order lines
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', flexShrink: 0 }}>
          {rowCount === 0 ? 'awaiting extraction' : `${rowCount} ${rowCount === 1 ? 'line' : 'lines'}`}
        </Typography>
      </Box>

      {rowCount === 0 ? (
        <Box sx={{ p: 2 }}>
          {pending ? (
            <>
              <Skeleton height={26} />
              <Skeleton height={26} width="86%" />
            </>
          ) : (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              No lines extracted from this document.
            </Typography>
          )}
        </Box>
      ) : (
        <Box sx={scrollX}>
          <Table size="small" sx={{ minWidth: 900 }}>
            <TableHead>
              <TableRow>
                <TableCell>Supplier item</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Minos ID</TableCell>
                <TableCell>Class</TableCell>
                <TableCell>Match</TableCell>
                <TableCell align="right">Qty (pcs)</TableCell>
                <TableCell align="right">Unit price</TableCell>
                <TableCell align="right">Extended</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {Array.from({ length: rowCount }, (_, index) => {
                const extracted = extractedLines[index];
                const validated =
                  validatedLines.find((line) => line.line_index === index) ?? validatedLines[index];
                const lineExceptions = openExceptions.filter((item) => item.line_index === index);
                const supplierItemNo =
                  validated?.supplier_item_no ?? extracted?.supplier_item_no ?? DASH;
                const description = validated?.product_name ?? extracted?.description ?? DASH;
                const printedDescription = extracted?.description ?? null;
                const match = validated?.match_method ?? null;
                const classification = validated?.classification ?? null;
                const unitPrice = validated?.unit_price ?? extracted?.unit_price ?? null;
                const qty = validated?.qty_pcs ?? extracted?.qty_pcs ?? null;
                const extendedPrice = validated?.extended_price ?? null;
                const failed = match === 'NONE' || lineExceptions.length > 0;

                return (
                  <Fragment key={`line-${index}`}>
                    <TableRow
                      sx={{ bgcolor: failed ? `${marsTokens.marsPetcareRed}08` : 'transparent' }}
                    >
                      <TableCell sx={{ maxWidth: 130 }}>
                        <Typography
                          sx={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.8125rem',
                            fontWeight: 700,
                            ...breakAnywhere,
                          }}
                        >
                          {supplierItemNo}
                        </Typography>
                        {extracted?.internal_ref ? (
                          <Typography
                            variant="caption"
                            sx={{ color: 'text.secondary', display: 'block', ...breakAnywhere }}
                          >
                            ref {extracted.internal_ref}
                          </Typography>
                        ) : null}
                      </TableCell>
                      <TableCell sx={{ maxWidth: 240 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, ...breakAnywhere }}>
                          {description}
                        </Typography>
                        {printedDescription !== null && printedDescription !== description && (
                          <Typography
                            variant="caption"
                            sx={{ color: 'text.secondary', display: 'block', ...breakAnywhere }}
                          >
                            printed as “{printedDescription}”
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ maxWidth: 120 }}>
                        <Typography
                          sx={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.8125rem',
                            fontWeight: 700,
                            color:
                              validated?.minos_id == null
                                ? marsTokens.marsPetcareRed
                                : marsTokens.darkGrey,
                            ...breakAnywhere,
                          }}
                        >
                          {validated?.minos_id ?? (pending ? '…' : 'unmapped')}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        {classification === null ? (
                          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                            {DASH}
                          </Typography>
                        ) : (
                          <Pill
                            label={classification}
                            color={classificationColor[classification] ?? marsTokens.lightGray}
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        {match === null ? (
                          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                            {DASH}
                          </Typography>
                        ) : (
                          <Pill
                            label={match}
                            color={matchMethodColor[match]}
                            title={`${MATCH_TOOLTIP[match]}${
                              validated?.match_confidence != null
                                ? ` Confidence ${validated.match_confidence.toFixed(2)}.`
                                : ''
                            }`}
                          />
                        )}
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {formatQty(qty)}
                        {extracted?.uom ? (
                          <Typography component="span" variant="caption" sx={{ color: 'text.secondary', ml: 0.5 }}>
                            {extracted.uom}
                          </Typography>
                        ) : null}
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {formatMoney(unitPrice, currency)}
                      </TableCell>
                      <TableCell
                        align="right"
                        sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, whiteSpace: 'nowrap' }}
                      >
                        {formatMoney(extendedPrice, currency)}
                      </TableCell>
                    </TableRow>
                    {lineExceptions.map((exception) => (
                      <TableRow key={`${index}-${exception.kind}-${exception.field}`}>
                        <TableCell colSpan={8} sx={{ py: 1.25, bgcolor: '#FAFAFC' }}>
                          <ExceptionCard
                            exception={exception}
                            onResolve={onResolve}
                            busy={busyField === exception.field}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      )}
    </Paper>
  );
}
