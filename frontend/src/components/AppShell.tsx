import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Alert,
  AppBar,
  Badge,
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { MarsLogo } from './MarsLogo';
import { PERSONA } from '../api/client';
import { marsTokens } from '../theme/marsTheme';

interface AppShellProps {
  children: ReactNode;
  /** The persistent agent rail; rendered beside every route and inside the drawer. */
  rail: ReactNode;
  onUpload: () => void;
  activeOrderId: string | null;
  openExceptionCount: number;
  offlineMessage: string | null;
  onRetry: () => void;
}

export function AppShell({
  children,
  rail,
  onUpload,
  activeOrderId,
  openExceptionCount,
  offlineMessage,
  onRetry,
}: AppShellProps) {
  const location = useLocation();
  const [railOpen, setRailOpen] = useState(false);

  const onWorkbench = location.pathname.startsWith('/orders/');
  const navItems = [
    { to: '/', label: 'Dashboard', active: location.pathname === '/', enabled: true, badge: 0 },
    {
      to: activeOrderId !== null ? `/orders/${activeOrderId}` : '/',
      label: 'Order workbench',
      active: onWorkbench,
      enabled: activeOrderId !== null,
      badge: 0,
    },
    {
      to: '/exceptions',
      label: 'Exceptions',
      active: location.pathname === '/exceptions',
      enabled: true,
      badge: openExceptionCount,
    },
  ];

  return (
    <Box sx={{ minHeight: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <AppBar
        position="sticky"
        elevation={0}
        sx={{
          bgcolor: marsTokens.marsBlue,
          backgroundImage: `linear-gradient(100deg, ${marsTokens.marsBlue} 0%, #000082 58%, #0B1FA8 100%)`,
          borderBottom: '1px solid rgba(255,255,255,0.14)',
        }}
      >
        <Toolbar
          sx={{
            gap: { xs: 1, lg: 2.5 },
            minHeight: { xs: 60, md: 66 },
            px: { xs: 1.5, md: 2.5 },
            minWidth: 0,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, flexShrink: 0, minWidth: 0 }}>
            <MarsLogo height={22} color={marsTokens.white} />
            <Divider
              orientation="vertical"
              flexItem
              sx={{ my: 1.5, borderColor: 'rgba(255,255,255,0.28)' }}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography
                sx={{
                  fontSize: '0.9375rem',
                  fontWeight: 800,
                  color: marsTokens.white,
                  lineHeight: 1.2,
                  whiteSpace: 'nowrap',
                }}
              >
                Royal Canin CNE — Order Operations
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  color: 'rgba(255,255,255,0.72)',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  display: { xs: 'none', lg: 'block' },
                }}
              >
                Agentic order processing · Mars Petcare
              </Typography>
            </Box>
          </Box>

          <Box
            component="nav"
            sx={{ display: { xs: 'none', md: 'flex' }, gap: 0.25, ml: 1, minWidth: 0 }}
          >
            {navItems.map(({ to, label, active, enabled, badge }) =>
              enabled ? (
                <Button
                  key={label}
                  component={NavLink}
                  to={to}
                  disableRipple
                  sx={{
                    px: 1.5,
                    py: 0.75,
                    borderRadius: 1.5,
                    fontSize: '0.875rem',
                    whiteSpace: 'nowrap',
                    color: active ? marsTokens.white : 'rgba(255,255,255,0.74)',
                    bgcolor: active ? 'rgba(255,255,255,0.16)' : 'transparent',
                    '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' },
                  }}
                >
                  <Badge
                    badgeContent={badge > 0 ? badge : null}
                    sx={{
                      '& .MuiBadge-badge': {
                        right: -12,
                        top: 2,
                        bgcolor: marsTokens.marsPetcareRed,
                        color: marsTokens.white,
                        fontWeight: 800,
                        fontSize: '0.625rem',
                        minWidth: 16,
                        height: 16,
                      },
                    }}
                  >
                    {label}
                  </Badge>
                </Button>
              ) : (
                <Tooltip key={label} title="Open an order to use the workbench">
                  <Box
                    component="span"
                    sx={{
                      px: 1.5,
                      py: 0.75,
                      fontSize: '0.875rem',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                      color: 'rgba(255,255,255,0.38)',
                      alignSelf: 'center',
                    }}
                  >
                    {label}
                  </Box>
                </Tooltip>
              ),
            )}
          </Box>

          <Box
            sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1.25, flexShrink: 0, minWidth: 0 }}
          >
            <Button
              variant="contained"
              size="small"
              onClick={onUpload}
              startIcon={<FileUploadOutlinedIcon sx={{ fontSize: 17 }} />}
              sx={{
                bgcolor: marsTokens.white,
                color: marsTokens.marsBlue,
                whiteSpace: 'nowrap',
                '&:hover': { bgcolor: 'rgba(255,255,255,0.88)' },
              }}
            >
              Upload order
            </Button>

            <Tooltip title="Agent activity">
              <IconButton
                onClick={() => setRailOpen(true)}
                aria-label="Open the agent activity rail"
                sx={{ display: { xs: 'inline-flex', lg: 'none' }, color: marsTokens.white }}
              >
                <InsightsOutlinedIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </Tooltip>

            <Box
              sx={{
                display: { xs: 'none', sm: 'flex' },
                alignItems: 'center',
                gap: 1,
                pl: 1.25,
                pr: 1.5,
                py: 0.5,
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.28)',
                bgcolor: 'rgba(255,255,255,0.08)',
              }}
            >
              <Box
                sx={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  bgcolor: marsTokens.white,
                  color: marsTokens.marsBlue,
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: '0.6875rem',
                  fontWeight: 800,
                  flexShrink: 0,
                }}
              >
                {PERSONA.initials}
              </Box>
              <Box sx={{ minWidth: 0, display: { xs: 'none', lg: 'block' } }}>
                <Typography
                  sx={{
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    color: marsTokens.white,
                    lineHeight: 1.2,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {PERSONA.name}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ color: 'rgba(255,255,255,0.7)', whiteSpace: 'nowrap' }}
                >
                  {PERSONA.role} · {PERSONA.team}
                </Typography>
              </Box>
            </Box>
          </Box>
        </Toolbar>
      </AppBar>

      {offlineMessage !== null && (
        <Alert
          severity="error"
          variant="filled"
          sx={{ borderRadius: 0, justifyContent: 'center' }}
          action={
            <Button color="inherit" size="small" onClick={onRetry} startIcon={<RefreshRoundedIcon />}>
              Retry
            </Button>
          }
        >
          {offlineMessage}
        </Alert>
      )}

      <Box sx={{ flex: 1, display: 'flex', alignItems: 'stretch', minWidth: 0 }}>
        <Box
          component="main"
          sx={{
            flex: 1,
            minWidth: 0,
            px: { xs: 2, md: 3 },
            py: { xs: 2.5, md: 3 },
            // The hero band bleeds to the edge of the content column, so pages
            // that need full bleed use negative margins against this padding.
            '--content-inline-padding': '24px',
          }}
        >
          <Box sx={{ width: '100%', minWidth: 0, maxWidth: 1400, mx: 'auto' }}>{children}</Box>
        </Box>

        <Box
          component="aside"
          sx={{
            display: { xs: 'none', lg: 'block' },
            width: 'var(--rail-width)',
            flexShrink: 0,
            borderLeft: '1px solid rgba(0,0,32,0.09)',
            bgcolor: marsTokens.white,
          }}
        >
          <Box
            sx={{
              position: 'sticky',
              top: 'var(--appbar-height)',
              height: 'calc(100vh - var(--appbar-height))',
              minWidth: 0,
            }}
          >
            {rail}
          </Box>
        </Box>
      </Box>

      <Drawer
        anchor="right"
        open={railOpen}
        onClose={() => setRailOpen(false)}
        PaperProps={{ sx: { width: 'min(340px, 92vw)', border: 0 } }}
      >
        <Box sx={{ position: 'relative', height: '100%', minWidth: 0 }}>
          <IconButton
            onClick={() => setRailOpen(false)}
            aria-label="Close the agent activity rail"
            sx={{ position: 'absolute', top: 6, right: 6, zIndex: 2, color: marsTokens.white }}
          >
            <CloseRoundedIcon sx={{ fontSize: 18 }} />
          </IconButton>
          {railOpen ? rail : null}
        </Box>
      </Drawer>
    </Box>
  );
}
