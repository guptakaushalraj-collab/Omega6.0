import { useState } from 'react';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useData } from '../offline/DataProvider.jsx';
import { usePortfolioData } from '../usePortfolioData.js';
import { money, percent } from '../format.js';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'JPY'];

function PortfolioCard({ portfolio, onDelete }) {
  const { summary } = usePortfolioData(portfolio.id);
  const gain = summary.unrealized_gain;

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Stack direction="row" alignItems="flex-start">
          <Stack sx={{ flexGrow: 1 }}>
            <Typography variant="h2">{portfolio.name}</Typography>
            <Typography variant="caption" color="text.secondary">
              {portfolio.base_currency} · {summary.positions} positions
            </Typography>
          </Stack>
          <IconButton aria-label={`Delete ${portfolio.name}`} size="small" onClick={() => onDelete(portfolio)}>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Typography variant="h5" sx={{ mt: 2, fontWeight: 700 }}>
          {money(summary.market_value, portfolio.base_currency)}
        </Typography>
        <Typography variant="body2" sx={{ color: gain >= 0 ? 'success.main' : 'error.main', fontWeight: 600 }}>
          {money(gain, portfolio.base_currency)} ({percent(summary.unrealized_gain_pct)})
        </Typography>
      </CardContent>
    </Card>
  );
}

export default function Portfolios() {
  const { portfolios, savePortfolio, deletePortfolio } = useData();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', base_currency: 'USD' });

  async function handleCreate() {
    if (!form.name.trim()) return;
    await savePortfolio(form);
    setForm({ name: '', base_currency: 'USD' });
    setOpen(false);
  }

  return (
    <Stack spacing={3}>
      <Stack direction="row" alignItems="center">
        <Typography variant="h1" sx={{ flexGrow: 1 }}>
          Portfolios
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
          New portfolio
        </Button>
      </Stack>

      {portfolios.length === 0 ? (
        <Typography color="text.secondary">No portfolios yet. Create one to start tracking positions.</Typography>
      ) : (
        <Grid container spacing={2}>
          {portfolios.map((portfolio) => (
            <Grid item xs={12} sm={6} md={4} key={portfolio.id}>
              <PortfolioCard portfolio={portfolio} onDelete={(p) => deletePortfolio(p.id)} />
            </Grid>
          ))}
        </Grid>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>New portfolio</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Name"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              autoFocus
              fullWidth
            />
            <TextField
              select
              label="Base currency"
              value={form.base_currency}
              onChange={(event) => setForm((prev) => ({ ...prev, base_currency: event.target.value }))}
              fullWidth
            >
              {CURRENCIES.map((currency) => (
                <MenuItem key={currency} value={currency}>
                  {currency}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate}>
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
