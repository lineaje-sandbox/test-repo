import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Box, Button, Paper, Typography } from '@mui/material';
import { MarsLogo } from './MarsLogo';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** A render error during a live pitch must degrade to a branded message, never a blank page. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }

    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3 }}>
        <Paper sx={{ p: 4, borderRadius: 3, maxWidth: 520, textAlign: 'center' }}>
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2.5 }}>
            <MarsLogo height={26} />
          </Box>
          <Typography variant="h3" sx={{ mb: 1 }}>
            Something went wrong
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
            Order operations hit an unexpected error while rendering. Reloading restores the session; no
            document or decision is lost.
          </Typography>
          <Box
            component="pre"
            sx={{
              m: 0,
              mb: 3,
              p: 1.5,
              textAlign: 'left',
              borderRadius: 1.5,
              bgcolor: '#1C1C28',
              color: '#E4E4EE',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.6875rem',
              overflow: 'auto',
              maxHeight: 160,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
            }}
          >
            {error.message}
          </Box>
          <Button variant="contained" onClick={() => window.location.reload()}>
            Reload order operations
          </Button>
        </Paper>
      </Box>
    );
  }
}
