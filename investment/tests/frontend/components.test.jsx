import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemeProvider } from '@mui/material/styles';
import HoldingsTable from '../../frontend/src/components/HoldingsTable.jsx';
import StatCard from '../../frontend/src/components/StatCard.jsx';
import { buildTheme } from '../../frontend/src/theme/theme.js';
import { money, percent, quantity, relativeTime, shortDate } from '../../frontend/src/format.js';

const renderWithTheme = (ui) => render(<ThemeProvider theme={buildTheme('light')}>{ui}</ThemeProvider>);

const holding = (over = {}) => ({
  asset_id: 'a1',
  symbol: 'VTI',
  name: 'Total Market ETF',
  asset_class: 'etf',
  currency: 'USD',
  quantity: 10,
  cost_basis: 1000,
  price: 110,
  market_value: 1100,
  unrealized_gain: 100,
  unrealized_gain_pct: 0.1,
  ...over,
});

describe('HoldingsTable', () => {
  it('prompts the user when there is nothing to show', () => {
    renderWithTheme(<HoldingsTable holdings={[]} />);
    expect(screen.getByText(/No open positions yet/i)).toBeInTheDocument();
  });

  it('renders a position with its value and gain', () => {
    renderWithTheme(<HoldingsTable holdings={[holding()]} />);

    const row = screen.getByText('VTI').closest('tr');
    expect(within(row).getByText('Total Market ETF')).toBeInTheDocument();
    expect(within(row).getByText('$1,100.00')).toBeInTheDocument();
    expect(within(row).getByText('+10.00%')).toBeInTheDocument();
  });

  it('flags an unpriced position rather than showing a misleading zero', () => {
    renderWithTheme(
      <HoldingsTable
        holdings={[holding({ price: null, market_value: null, unrealized_gain: null, unrealized_gain_pct: null })]}
      />,
    );

    expect(screen.getByText('no price')).toBeInTheDocument();
    // Em-dashes, not $0.00 — a missing mark is unknown, not worthless.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('renders every holding it is given', () => {
    renderWithTheme(
      <HoldingsTable holdings={[holding(), holding({ asset_id: 'a2', symbol: 'BND', asset_class: 'bond' })]} />,
    );
    expect(screen.getByText('VTI')).toBeInTheDocument();
    expect(screen.getByText('BND')).toBeInTheDocument();
  });
});

describe('StatCard', () => {
  it('shows its label, value and hint', () => {
    renderWithTheme(<StatCard label="Market value" value="$1,100.00" hint="2 positions" />);
    expect(screen.getByText('Market value')).toBeInTheDocument();
    expect(screen.getByText('$1,100.00')).toBeInTheDocument();
    expect(screen.getByText('2 positions')).toBeInTheDocument();
  });
});

describe('formatters', () => {
  it('renders an em-dash for missing numbers instead of NaN or 0', () => {
    expect(money(null)).toBe('—');
    expect(money(undefined)).toBe('—');
    expect(percent(null)).toBe('—');
    expect(quantity(null)).toBe('—');
    expect(shortDate(null)).toBe('—');
    expect(shortDate('not-a-date')).toBe('—');
  });

  it('signs percentages so a loss is unmistakable', () => {
    expect(percent(0.1234)).toBe('+12.34%');
    expect(percent(-0.05)).toBe('-5.00%');
  });

  it('formats money in the requested currency', () => {
    expect(money(1100, 'USD')).toBe('$1,100.00');
    expect(money(1100, 'EUR')).toContain('1,100.00');
  });

  it('describes sync recency in human terms', () => {
    expect(relativeTime(null)).toBe('never');
    expect(relativeTime(new Date().toISOString())).toBe('just now');
    expect(relativeTime(new Date(Date.now() - 5 * 60_000).toISOString())).toBe('5m ago');
    expect(relativeTime(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe('3h ago');
  });
});
