import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useData } from '../offline/DataProvider.jsx';
import { money, shortDate } from '../format.js';

/**
 * Manual marks. This project deliberately has no market-data vendor: an
 * offline-first app cannot depend on a live quote feed, and a stale mark the
 * user entered themselves is more honest than one silently fetched last week.
 */
export default function Prices() {
  const { assets, prices, savePrice, queue } = useData();
  const [drafts, setDrafts] = useState({});

  const latest = useMemo(() => {
    const byAsset = new Map();
    for (const price of prices) {
      const current = byAsset.get(price.asset_id);
      if (!current || price.as_of > current.as_of) byAsset.set(price.asset_id, price);
    }
    return byAsset;
  }, [prices]);

  const queuedAssets = useMemo(
    () => new Set(queue.filter((op) => op.type === 'price.upsert').map((op) => op.payload.asset_id)),
    [queue],
  );

  async function handleSave(assetId) {
    const value = drafts[assetId];
    if (value === undefined || value === '' || Number.isNaN(Number(value))) return;
    await savePrice(assetId, Number(value));
    setDrafts((prev) => ({ ...prev, [assetId]: '' }));
  }

  return (
    <Stack spacing={3}>
      <Typography variant="h1">Prices</Typography>
      <Alert severity="info">
        Prices are entered manually and stored locally first, so valuations keep working with no
        network. Each entry is dated — anything older than your last trade is worth refreshing.
      </Alert>

      {assets.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">Assets appear here once you record a transaction.</Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Symbol</TableCell>
                <TableCell>Name</TableCell>
                <TableCell align="right">Last price</TableCell>
                <TableCell>As of</TableCell>
                <TableCell align="right">New price</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {assets.map((asset) => {
                const price = latest.get(asset.id);
                return (
                  <TableRow key={asset.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{asset.symbol}</TableCell>
                    <TableCell>{asset.name}</TableCell>
                    <TableCell align="right">{price ? money(price.close, asset.currency) : '—'}</TableCell>
                    <TableCell>
                      {price ? shortDate(price.as_of) : 'never'}
                      {queuedAssets.has(asset.id) ? ' · queued' : ''}
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} justifyContent="flex-end">
                        <TextField
                          size="small"
                          type="number"
                          placeholder="0.00"
                          value={drafts[asset.id] ?? ''}
                          onChange={(event) =>
                            setDrafts((prev) => ({ ...prev, [asset.id]: event.target.value }))
                          }
                          inputProps={{ 'aria-label': `New price for ${asset.symbol}` }}
                          sx={{ width: 120 }}
                        />
                        <Button size="small" onClick={() => handleSave(asset.id)}>
                          Save
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  );
}
