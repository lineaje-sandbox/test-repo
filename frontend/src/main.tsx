import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { marsTheme } from './theme/marsTheme';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

import './styles/tokens.css';
import './styles/fonts.css';
import './styles/global.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root container #root is missing from index.html.');
}

createRoot(container).render(
  <StrictMode>
    <ThemeProvider theme={marsTheme}>
      <CssBaseline />
      <ErrorBoundary>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
);
