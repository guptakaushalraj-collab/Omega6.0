import {
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { money, percent, quantity } from '../format.js';

export default function HoldingsTable({ holdings, currency = 'USD' }) {
  if (!holdings.length) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="text.secondary">
          No open positions yet — add a buy transaction to get started.
        </Typography>
      </Paper>
    );
  }

  return (
    <TableContainer component={Paper} variant="outlined" sx={{ overflowX: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Symbol</TableCell>
            <TableCell>Class</TableCell>
            <TableCell align="right">Quantity</TableCell>
            <TableCell align="right">Price</TableCell>
            <TableCell align="right">Market value</TableCell>
            <TableCell align="right">Cost basis</TableCell>
            <TableCell align="right">Unrealised</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {holdings.map((holding) => (
            <TableRow key={holding.asset_id} hover>
              <TableCell>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {holding.symbol}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {holding.name}
                </Typography>
              </TableCell>
              <TableCell>
                <Chip size="small" variant="outlined" label={holding.asset_class} />
              </TableCell>
              <TableCell align="right">{quantity(holding.quantity)}</TableCell>
              <TableCell align="right">
                {holding.price === null ? (
                  <Chip size="small" color="warning" variant="outlined" label="no price" />
                ) : (
                  money(holding.price, currency)
                )}
              </TableCell>
              <TableCell align="right">{money(holding.market_value, currency)}</TableCell>
              <TableCell align="right">{money(holding.cost_basis, currency)}</TableCell>
              <TableCell
                align="right"
                sx={{
                  color:
                    holding.unrealized_gain === null
                      ? 'text.secondary'
                      : holding.unrealized_gain >= 0
                        ? 'success.main'
                        : 'error.main',
                  fontWeight: 600,
                }}
              >
                {money(holding.unrealized_gain, currency)}
                {holding.unrealized_gain_pct === null ? null : (
                  <Typography variant="caption" display="block" color="inherit">
                    {percent(holding.unrealized_gain_pct)}
                  </Typography>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
