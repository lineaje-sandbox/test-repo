import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  Typography,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined';
import { api } from '../api/client';
import type { SampleDoc, UploadResponse } from '../api/types';
import { marsTokens } from '../theme/marsTheme';
import { breakAnywhere, stackGrid } from '../theme/layout';

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
  onUploaded: (response: UploadResponse) => void;
}

export function UploadDialog({ open, onClose, onUploaded }: UploadDialogProps) {
  const [samples, setSamples] = useState<SampleDoc[]>([]);
  const [samplesLoading, setSamplesLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setSamplesLoading(true);
    void api
      .samples()
      .then((next) => {
        if (!cancelled) setSamples(next);
      })
      .catch(() => {
        if (!cancelled) setSamples([]);
      })
      .finally(() => {
        if (!cancelled) setSamplesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const run = async (token: string, action: () => Promise<UploadResponse>): Promise<void> => {
    setBusy(token);
    setError(null);
    try {
      const response = await action();
      onUploaded(response);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed.');
    } finally {
      setBusy(null);
    }
  };

  const submitFile = (file: File | undefined): void => {
    if (file === undefined) return;
    void run('file', () => api.uploadFile(file));
  };

  return (
    <Dialog open={open} onClose={busy === null ? onClose : undefined} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pr: 6, pb: 1 }}>
        <Typography variant="h6" sx={{ color: 'text.secondary', mb: 0.5 }}>
          New order
        </Typography>
        <Typography variant="h3">Upload a purchase order</Typography>
        <IconButton
          onClick={onClose}
          disabled={busy !== null}
          aria-label="Close"
          sx={{ position: 'absolute', top: 12, right: 12 }}
        >
          <CloseRoundedIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ ...stackGrid, gap: 2.5 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          The ingestion agent reads the PDF as it arrives — no template, no layout rules. Drop a file or
          start from one of the prepared documents.
        </Typography>

        <Box
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            submitFile(event.dataTransfer.files[0]);
          }}
          onClick={() => fileInputRef.current?.click()}
          sx={{
            ...stackGrid,
            justifyItems: 'center',
            gap: 1,
            px: 2,
            py: 3.5,
            borderRadius: 2,
            cursor: 'pointer',
            textAlign: 'center',
            border: `1.5px dashed ${dragging ? marsTokens.marsBlue : 'rgba(0,0,32,0.18)'}`,
            bgcolor: dragging ? 'rgba(0,0,160,0.04)' : '#FAFAFC',
            transition: 'border-color 140ms ease, background-color 140ms ease',
          }}
        >
          <FileUploadOutlinedIcon sx={{ fontSize: 26, color: marsTokens.marsBlue }} />
          <Typography sx={{ fontSize: '0.875rem', fontWeight: 700 }}>
            Drop a PDF here, or browse
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Single-page or multi-page purchase orders, up to a few megabytes
          </Typography>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(event) => {
              submitFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </Box>

        {busy === 'file' && <LinearProgress />}

        <Divider>
          <Typography variant="caption" sx={{ color: 'text.secondary', letterSpacing: '0.08em' }}>
            OR USE A PREPARED DOCUMENT
          </Typography>
        </Divider>

        {samplesLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress size={22} />
          </Box>
        ) : samples.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            No prepared documents are available from the service.
          </Typography>
        ) : (
          <Box sx={{ ...stackGrid, gap: 1.25 }}>
            {samples.map((sample) => (
              <Box
                key={sample.name}
                onClick={busy === null ? () => void run(sample.name, () => api.uploadSample(sample.name)) : undefined}
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 1.5,
                  p: 1.5,
                  borderRadius: 2,
                  border: '1px solid rgba(0,0,32,0.09)',
                  cursor: busy === null ? 'pointer' : 'default',
                  minWidth: 0,
                  opacity: busy !== null && busy !== sample.name ? 0.5 : 1,
                  '&:hover': { borderColor: busy === null ? marsTokens.marsBlue : undefined },
                }}
              >
                <DescriptionOutlinedIcon
                  sx={{ fontSize: 20, color: marsTokens.marsBlue, mt: 0.25, flexShrink: 0 }}
                />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, ...breakAnywhere }}>
                    {sample.label}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary', ...breakAnywhere }}>
                    {sample.blurb}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ display: 'block', mt: 0.5, color: marsTokens.marsBlue, fontWeight: 700 }}
                  >
                    Demonstrates: {sample.expects}
                  </Typography>
                </Box>
                {busy === sample.name && <CircularProgress size={18} sx={{ flexShrink: 0, mt: 0.25 }} />}
              </Box>
            ))}
          </Box>
        )}

        {error !== null && (
          <Typography variant="body2" sx={{ color: marsTokens.marsPetcareRed, ...breakAnywhere }}>
            {error}
          </Typography>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={busy !== null} sx={{ color: 'text.secondary' }}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  );
}
