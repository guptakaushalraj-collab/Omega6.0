import { createTheme } from '@mui/material/styles';

const shared = {
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    h1: { fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.02em' },
    h2: { fontSize: '1.25rem', fontWeight: 650, letterSpacing: '-0.01em' },
    // Money is read in columns, so it needs tabular figures to line up.
    body2: { fontVariantNumeric: 'tabular-nums' },
  },
  components: {
    MuiCard: { defaultProps: { elevation: 0 }, styleOverrides: { root: { border: '1px solid' } } },
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiTableCell: { styleOverrides: { root: { fontVariantNumeric: 'tabular-nums' } } },
  },
};

export function buildTheme(mode = 'light') {
  return createTheme({
    ...shared,
    palette: {
      mode,
      primary: { main: mode === 'light' ? '#1b5e5f' : '#7fd1c1' },
      secondary: { main: '#f2b544' },
      success: { main: mode === 'light' ? '#1b7f4d' : '#57c98a' },
      error: { main: mode === 'light' ? '#b3261e' : '#f2837a' },
      background:
        mode === 'light'
          ? { default: '#f6f7f9', paper: '#ffffff' }
          : { default: '#11151a', paper: '#171d24' },
    },
    components: {
      ...shared.components,
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            border: `1px solid ${mode === 'light' ? '#e3e7ec' : '#28313b'}`,
            backgroundImage: 'none',
          },
        },
      },
    },
  });
}
