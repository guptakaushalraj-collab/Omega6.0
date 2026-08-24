import { useState } from 'react';
import AddIcon from '@mui/icons-material/Add';
import { Alert, Box, Button, Grid, MenuItem, Stack, TextField, Typography } from '@mui/material';
import AllocationChart from '../components/AllocationChart.jsx';
import HoldingsTable from '../components/HoldingsTable.jsx';
import StatCard from '../components/StatCard.jsx';
import TransactionDialog from '../components/TransactionDialog.jsx';
import { useData } from '../offline/DataProvider.jsx';
import { usePortfolioData } from '../usePortfolioData.js';
import { money, percent } from '../format.js';

export default function Dashboard() {
  const { portfolios, online } = useData();
  const [selected, setSelected] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const portfolioId = selected || portfolios[0]?.id || '';
  const { portfolio, holdings, summary, allocation } = usePortfolioData(portfolioId);
  const currency = portfolio?.base_currency || 'USD';

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h1">Dashboard</Typography>
          <Typography color="text.secondary" variant="body2">
            {online ? 'Live data, synced automatically.' : 'Offline — showing the last synced data on this device.'}
          </Typography>
        </Box>
        <TextField
          select
          size="small"
          label="Portfolio"
          value={portfolioId}
          onChange={(event) => setSelected(event.target.value)}
          sx={{ minWidth: 220 }}
        >
          {portfolios.map((option) => (
            <MenuItem key={option.id} value={option.id}>
              {option.name}
            </MenuItem>
          ))}
        </TextField>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
          Add transaction
        </Button>
      </Stack>

      {summary.unpriced_positions > 0 ? (
        <Alert severity="info">
          {summary.unpriced_positions} position{summary.unpriced_positions === 1 ? ' has' : 's have'} no
          synced price, so it is excluded from the totals below. Add a price on the Prices tab.
        </Alert>
      ) : null}

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard label="Market value" value={money(summary.market_value, currency)} hint={`${summary.positions} positions`} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard label="Cost basis" value={money(summary.cost_basis, currency)} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            label="Unrealised P/L"
            value={money(summary.unrealized_gain, currency)}
            hint={percent(summary.unrealized_gain_pct)}
            tone={summary.unrealized_gain >= 0 ? 'positive' : 'negative'}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard label="Income received" value={money(summary.income, currency)} hint="Dividends to date" />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid item xs={12} md={8}>
          <HoldingsTable holdings={holdings} currency={currency} />
        </Grid>
        <Grid item xs={12} md={4}>
          <AllocationChart allocation={allocation} currency={currency} />
        </Grid>
      </Grid>

      <TransactionDialog open={dialogOpen} onClose={() => setDialogOpen(false)} portfolioId={portfolioId} />
    </Stack>
  );
}
