import { useMemo, useState } from 'react';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import {
  Button,
  Chip,
  IconButton,
  MenuItem,
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
import TransactionDialog from '../components/TransactionDialog.jsx';
import { useData } from '../offline/DataProvider.jsx';
import { money, quantity, shortDate } from '../format.js';

const TYPE_COLOR = { buy: 'primary', sell: 'secondary', dividend: 'success' };

export default function Transactions() {
  const { portfolios, assets, transactions, queue, deleteTransaction } = useData();
  const [filter, setFilter] = useState('');
  const [dialog, setDialog] = useState({ open: false, initial: null });

  const symbolByAsset = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset.symbol])),
    [assets],
  );
  // A transaction still sitting in the queue gets a badge, so the user knows
  // exactly which rows the server has not seen yet.
  const queuedIds = useMemo(
    () => new Set(queue.map((op) => op.payload?.id).filter(Boolean)),
    [queue],
  );

  const rows = useMemo(
    () =>
      transactions
        .filter((tx) => !filter || tx.portfolio_id === filter)
        .sort((a, b) => (b.traded_at || '').localeCompare(a.traded_at || '')),
    [transactions, filter],
  );

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
        <Typography variant="h1" sx={{ flexGrow: 1 }}>
          Transactions
        </Typography>
        <TextField
          select
          size="small"
          label="Portfolio"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">All portfolios</MenuItem>
          {portfolios.map((portfolio) => (
            <MenuItem key={portfolio.id} value={portfolio.id}>
              {portfolio.name}
            </MenuItem>
          ))}
        </TextField>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({ open: true, initial: null })}>
          Add transaction
        </Button>
      </Stack>

      {rows.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">No transactions recorded yet.</Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Symbol</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">Quantity</TableCell>
                <TableCell align="right">Price</TableCell>
                <TableCell align="right">Fee</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((tx) => (
                <TableRow key={tx.id} hover>
                  <TableCell>
                    {shortDate(tx.traded_at)}
                    {queuedIds.has(tx.id) ? (
                      <Chip size="small" variant="outlined" color="warning" label="queued" sx={{ ml: 1 }} />
                    ) : null}
                  </TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{symbolByAsset.get(tx.asset_id) || '—'}</TableCell>
                  <TableCell>
                    <Chip size="small" color={TYPE_COLOR[tx.type]} variant="outlined" label={tx.type} />
                  </TableCell>
                  <TableCell align="right">{quantity(tx.quantity)}</TableCell>
                  <TableCell align="right">{money(tx.price)}</TableCell>
                  <TableCell align="right">{money(tx.fee)}</TableCell>
                  <TableCell align="right">{money(tx.quantity * tx.price + (tx.fee || 0))}</TableCell>
                  <TableCell align="right">
                    <IconButton
                      size="small"
                      aria-label="Edit transaction"
                      onClick={() => setDialog({ open: true, initial: tx })}
                    >
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label="Delete transaction"
                      onClick={() => deleteTransaction(tx.id)}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <TransactionDialog
        open={dialog.open}
        initial={dialog.initial}
        onClose={() => setDialog({ open: false, initial: null })}
      />
    </Stack>
  );
}
