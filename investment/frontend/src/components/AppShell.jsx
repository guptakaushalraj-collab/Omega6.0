import { AppBar, Box, Container, Tab, Tabs, Toolbar, Typography } from '@mui/material';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import { Link, Outlet, useLocation } from 'react-router-dom';
import SyncStatus from './SyncStatus.jsx';

const TABS = [
  { label: 'Dashboard', to: '/' },
  { label: 'Portfolios', to: '/portfolios' },
  { label: 'Transactions', to: '/transactions' },
  { label: 'Prices', to: '/prices' },
];

export default function AppShell() {
  const { pathname } = useLocation();
  const active = TABS.map((tab) => tab.to).includes(pathname) ? pathname : '/';

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 2, flexWrap: 'wrap' }}>
          <ShowChartIcon color="primary" />
          <Typography variant="h6" sx={{ fontWeight: 700, mr: 2 }}>
            Investment Manager
          </Typography>
          <Tabs value={active} sx={{ flexGrow: 1, minHeight: 48 }}>
            {TABS.map((tab) => (
              <Tab key={tab.to} label={tab.label} value={tab.to} component={Link} to={tab.to} />
            ))}
          </Tabs>
          <SyncStatus />
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Outlet />
      </Container>
    </Box>
  );
}
