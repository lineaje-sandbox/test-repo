import { createTheme } from '@mui/material/styles';
import type { MatchMethod, OrderStatus, Severity, StepStatus } from '../api/types';

/** Mirrors src/styles/tokens.css so MUI and raw CSS never drift. */
export const marsTokens = {
  marsBlue: '#0000A0',
  marsGreen: '#00D7B9',
  marsPetcareRed: '#FF1414',
  marsWrigley: '#E6A000',
  marsFoodGreen: '#61A020',
  spicyRed: '#FF3C14',
  zestyOrange: '#FF8200',
  marsEdge: '#0099FF',
  skyBlue: '#00DCFA',
  marsYellow: '#FFDC00',
  darkGrey: '#3C3C3C',
  lightGray: '#A3A3A3',
  bgGray: '#F4F4F4',
  white: '#FFFFFF',
} as const;

export const fontStack = "'MarsCentra', 'Figtree', Arial, sans-serif";
export const monoStack = "'IBM Plex Mono', 'SFMono-Regular', 'Menlo', 'Consolas', monospace";

export const severityColor: Record<Severity, string> = {
  BLOCKING: marsTokens.marsPetcareRed,
  WARNING: marsTokens.marsWrigley,
};

/** EXACT green, FUZZY amber, HUMAN blue, NONE red — the four master-data outcomes. */
export const matchMethodColor: Record<MatchMethod, string> = {
  EXACT: marsTokens.marsGreen,
  FUZZY: marsTokens.marsWrigley,
  HUMAN: marsTokens.marsEdge,
  NONE: marsTokens.marsPetcareRed,
};

export const statusColor: Record<OrderStatus, string> = {
  RECEIVED: marsTokens.lightGray,
  EXTRACTING: marsTokens.marsEdge,
  VALIDATING: marsTokens.marsEdge,
  READY: marsTokens.marsGreen,
  EXCEPTION: marsTokens.marsPetcareRed,
  APPROVED: marsTokens.marsBlue,
  FAILED: marsTokens.spicyRed,
};

export const stepStatusColor: Record<StepStatus, string> = {
  RUNNING: marsTokens.marsEdge,
  DONE: marsTokens.marsGreen,
  FAILED: marsTokens.marsPetcareRed,
};

/** PSR / VET / STD product classifications carried on every reconciled line. */
export const classificationColor: Record<string, string> = {
  PSR: marsTokens.marsBlue,
  VET: marsTokens.marsFoodGreen,
  STD: marsTokens.lightGray,
};

export const marsTheme = createTheme({
  breakpoints: {
    // lg is the threshold the agent rail appears at, so the split sits at 1200.
    values: { xs: 0, sm: 600, md: 900, lg: 1200, xl: 1536 },
  },
  palette: {
    mode: 'light',
    primary: { main: marsTokens.marsBlue, contrastText: marsTokens.white },
    secondary: { main: marsTokens.marsGreen, contrastText: '#00332C' },
    error: { main: marsTokens.marsPetcareRed },
    warning: { main: marsTokens.marsWrigley },
    success: { main: marsTokens.marsGreen },
    info: { main: marsTokens.marsEdge },
    background: { default: marsTokens.bgGray, paper: marsTokens.white },
    text: { primary: marsTokens.darkGrey, secondary: '#6E6E7A', disabled: marsTokens.lightGray },
    divider: 'rgba(0, 0, 32, 0.09)',
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: fontStack,
    h1: { fontFamily: fontStack, fontWeight: 800, fontSize: '2.25rem', letterSpacing: '-0.02em' },
    h2: { fontFamily: fontStack, fontWeight: 800, fontSize: '1.75rem', letterSpacing: '-0.015em' },
    h3: { fontFamily: fontStack, fontWeight: 700, fontSize: '1.375rem', letterSpacing: '-0.01em' },
    h4: { fontFamily: fontStack, fontWeight: 700, fontSize: '1.125rem' },
    h5: { fontFamily: fontStack, fontWeight: 700, fontSize: '1rem' },
    h6: {
      fontFamily: fontStack,
      fontWeight: 700,
      fontSize: '0.75rem',
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
    },
    subtitle2: { fontWeight: 700, fontSize: '0.8125rem' },
    body1: { fontSize: '0.9375rem', lineHeight: 1.6 },
    body2: { fontSize: '0.8125rem', lineHeight: 1.55 },
    caption: { fontSize: '0.6875rem', letterSpacing: '0.04em' },
    button: { fontWeight: 700, textTransform: 'none', letterSpacing: '0.01em' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: marsTokens.bgGray },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid rgba(0, 0, 32, 0.07)',
        },
        rounded: { borderRadius: 12 },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 6, paddingInline: 18, paddingBlock: 9 },
        sizeSmall: { paddingInline: 12, paddingBlock: 5, fontSize: '0.8125rem' },
        containedPrimary: {
          '&:hover': { backgroundColor: '#000078' },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 700, letterSpacing: '0.01em' },
        sizeSmall: { height: 22, fontSize: '0.6875rem' },
      },
    },
    MuiTooltip: {
      defaultProps: { arrow: true },
      styleOverrides: {
        tooltip: {
          backgroundColor: marsTokens.darkGrey,
          fontSize: '0.75rem',
          fontWeight: 500,
          padding: '8px 10px',
          maxWidth: 280,
        },
        arrow: { color: marsTokens.darkGrey },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottomColor: 'rgba(0, 0, 32, 0.06)' },
        head: {
          fontWeight: 700,
          fontSize: '0.6875rem',
          letterSpacing: '0.09em',
          textTransform: 'uppercase',
          color: '#6E6E7A',
          whiteSpace: 'nowrap',
          backgroundColor: '#FAFAFC',
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: 999, height: 6, backgroundColor: 'rgba(0, 0, 32, 0.07)' },
        bar: { borderRadius: 999 },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 14 },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { backgroundColor: marsTokens.white },
      },
    },
  },
});
