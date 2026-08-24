import { useMemo, useState } from 'react';
import { CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Portfolios from './pages/Portfolios.jsx';
import Prices from './pages/Prices.jsx';
import Transactions from './pages/Transactions.jsx';
import { DataProvider } from './offline/DataProvider.jsx';
import { buildTheme } from './theme/theme.js';

export default function App() {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const [mode] = useState(null);
  const theme = useMemo(() => buildTheme(mode ?? (prefersDark ? 'dark' : 'light')), [mode, prefersDark]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <DataProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<Dashboard />} />
            <Route path="portfolios" element={<Portfolios />} />
            <Route path="transactions" element={<Transactions />} />
            <Route path="prices" element={<Prices />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </DataProvider>
    </ThemeProvider>
  );
}
