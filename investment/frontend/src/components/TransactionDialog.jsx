import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from '@mui/material';
import { useData } from '../offline/DataProvider.jsx';

const TYPES = ['buy', 'sell', 'dividend'];
const CLASSES = ['equity', 'etf', 'bond', 'crypto', 'cash', 'other'];

const EMPTY = {
  portfolio_id: '',
  symbol: '',
  asset_class: 'equity',
  type: 'buy',
  quantity: '',
  price: '',
  fee: '0',
  traded_at: new Date().toISOString().slice(0, 10),
  note: '',
};

export default function TransactionDialog({ open, onClose, portfolioId, initial }) {
  const { portfolios, assets, saveAsset, saveTransaction } = useData();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const asset = initial ? assets.find((a) => a.id === initial.asset_id) : null;
    setForm({
      ...EMPTY,
      portfolio_id: initial?.portfolio_id || portfolioId || portfolios[0]?.id || '',
      ...(initial
        ? {
            id: initial.id,
            created_at: initial.created_at,
            symbol: asset?.symbol || '',
            asset_class: asset?.asset_class || 'equity',
            type: initial.type,
            quantity: String(initial.quantity),
            price: String(initial.price),
            fee: String(initial.fee ?? 0),
            traded_at: (initial.traded_at || '').slice(0, 10),
            note: initial.note || '',
          }
        : {}),
    });
    setError(null);
  }, [open, initial, portfolioId, portfolios, assets]);

  const set = (field) => (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));

  async function handleSave() {
    if (!form.portfolio_id) return setError('Choose a portfolio.');
    if (!form.symbol.trim()) return setError('Enter a ticker symbol.');
    if (!(Number(form.quantity) >= 0)) return setError('Quantity must be a non-negative number.');
    if (!(Number(form.price) >= 0)) return setError('Price must be a non-negative number.');

    setSaving(true);
    try {
      const symbol = form.symbol.trim().toUpperCase();
      // Reuse an existing asset when the symbol already exists, so two offline
      // devices entering "AAPL" converge on one asset instead of two.
      const existing = assets.find((asset) => asset.symbol === symbol);
      const asset = existing || (await saveAsset({ symbol, asset_class: form.asset_class }));

      await saveTransaction({
        id: form.id,
        created_at: form.created_at,
        portfolio_id: form.portfolio_id,
        asset_id: asset.id,
        type: form.type,
        quantity: form.quantity,
        price: form.price,
        fee: form.fee,
        traded_at: new Date(form.traded_at).toISOString(),
        note: form.note,
      });
      onClose();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
    return undefined;
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{initial ? 'Edit transaction' : 'Record transaction'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField select label="Portfolio" value={form.portfolio_id} onChange={set('portfolio_id')} fullWidth>
            {portfolios.map((portfolio) => (
              <MenuItem key={portfolio.id} value={portfolio.id}>
                {portfolio.name}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Symbol"
              value={form.symbol}
              onChange={set('symbol')}
              fullWidth
              inputProps={{ 'aria-label': 'Symbol', style: { textTransform: 'uppercase' } }}
            />
            <TextField select label="Asset class" value={form.asset_class} onChange={set('asset_class')} fullWidth>
              {CLASSES.map((assetClass) => (
                <MenuItem key={assetClass} value={assetClass}>
                  {assetClass}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField select label="Type" value={form.type} onChange={set('type')} fullWidth>
              {TYPES.map((type) => (
                <MenuItem key={type} value={type}>
                  {type}
                </MenuItem>
              ))}
            </TextField>
            <TextField label="Quantity" value={form.quantity} onChange={set('quantity')} type="number" fullWidth />
            <TextField label="Price" value={form.price} onChange={set('price')} type="number" fullWidth />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label="Fee" value={form.fee} onChange={set('fee')} type="number" fullWidth />
            <TextField
              label="Trade date"
              value={form.traded_at}
              onChange={set('traded_at')}
              type="date"
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Stack>
          <TextField label="Note" value={form.note} onChange={set('note')} fullWidth multiline rows={2} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
