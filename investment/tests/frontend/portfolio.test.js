import { describe, expect, it } from 'vitest';
import {
  byAssetClass,
  computeHoldings,
  priceHoldings,
  summarize,
} from '../../frontend/src/offline/portfolio.js';

const assets = [
  { id: 'a1', symbol: 'VTI', name: 'Total Market', asset_class: 'etf', currency: 'USD' },
  { id: 'a2', symbol: 'BND', name: 'Total Bond', asset_class: 'bond', currency: 'USD' },
];

const tx = (over) => ({
  id: 'x',
  portfolio_id: 'p1',
  asset_id: 'a1',
  type: 'buy',
  quantity: 10,
  price: 100,
  fee: 0,
  ...over,
});

describe('computeHoldings', () => {
  it('adds buys and subtracts sells', () => {
    const [holding] = computeHoldings(
      [tx({ id: '1' }), tx({ id: '2', type: 'sell', quantity: 4, price: 120 })],
      assets,
    );
    expect(holding.quantity).toBe(6);
    // 10*100 - (4*120) = 1000 - 480
    expect(holding.cost_basis).toBeCloseTo(520, 10);
  });

  it('adds fees to cost basis on a buy and subtracts proceeds net of fees on a sell', () => {
    const [holding] = computeHoldings(
      [tx({ id: '1', fee: 5 }), tx({ id: '2', type: 'sell', quantity: 2, price: 100, fee: 3 })],
      assets,
    );
    // buy: 10*100 + 5 = 1005; sell: -(2*100 - 3) = -197
    expect(holding.cost_basis).toBeCloseTo(808, 10);
  });

  it('treats a dividend as income without changing quantity or cost basis', () => {
    const [holding] = computeHoldings(
      [tx({ id: '1' }), tx({ id: '2', type: 'dividend', quantity: 10, price: 0.5 })],
      assets,
    );
    expect(holding.quantity).toBe(10);
    expect(holding.cost_basis).toBeCloseTo(1000, 10);
    expect(holding.income).toBeCloseTo(5, 10);
  });

  it('ignores soft-deleted transactions and transactions for unknown assets', () => {
    const holdings = computeHoldings(
      [
        tx({ id: '1' }),
        tx({ id: '2', deleted_at: '2026-01-01T00:00:00.000Z' }),
        tx({ id: '3', asset_id: 'ghost' }),
      ],
      assets,
    );
    expect(holdings).toHaveLength(1);
    expect(holdings[0].quantity).toBe(10);
  });

  it('ignores transactions whose asset has been soft-deleted', () => {
    const holdings = computeHoldings(
      [tx({ id: '1' })],
      [{ ...assets[0], deleted_at: '2026-01-01T00:00:00.000Z' }],
    );
    expect(holdings).toHaveLength(0);
  });
});

describe('priceHoldings', () => {
  it('leaves market value null when no price is known', () => {
    const [holding] = priceHoldings(computeHoldings([tx({ id: '1' })], assets), new Map());
    expect(holding.price).toBeNull();
    expect(holding.market_value).toBeNull();
    expect(holding.unrealized_gain).toBeNull();
    expect(holding.unrealized_gain_pct).toBeNull();
  });

  it('computes gain and percentage against cost basis', () => {
    const [holding] = priceHoldings(
      computeHoldings([tx({ id: '1' })], assets),
      new Map([['a1', 110]]),
    );
    expect(holding.market_value).toBeCloseTo(1100, 10);
    expect(holding.unrealized_gain).toBeCloseTo(100, 10);
    expect(holding.unrealized_gain_pct).toBeCloseTo(0.1, 10);
  });

  it('avoids dividing by zero when cost basis nets out to nothing', () => {
    const [holding] = priceHoldings(
      [{ asset_id: 'a1', quantity: 5, cost_basis: 0, asset_class: 'etf' }],
      new Map([['a1', 20]]),
    );
    expect(holding.unrealized_gain).toBeCloseTo(100, 10);
    expect(holding.unrealized_gain_pct).toBeNull();
  });
});

describe('summarize', () => {
  it('excludes unpriced positions from the totals but still counts them', () => {
    const positions = priceHoldings(
      computeHoldings([tx({ id: '1' }), tx({ id: '2', asset_id: 'a2', price: 50 })], assets),
      new Map([['a1', 110]]),
    );
    const summary = summarize(positions);

    expect(summary.positions).toBe(2);
    expect(summary.unpriced_positions).toBe(1);
    expect(summary.market_value).toBeCloseTo(1100, 10);
    expect(summary.cost_basis).toBeCloseTo(1000, 10);
  });

  it('returns a null percentage rather than Infinity on a zero cost basis', () => {
    expect(summarize([]).unrealized_gain_pct).toBeNull();
  });
});

describe('byAssetClass', () => {
  it('weights each class by market value and sorts largest first', () => {
    const positions = priceHoldings(
      computeHoldings([tx({ id: '1' }), tx({ id: '2', asset_id: 'a2', quantity: 5, price: 20 })], assets),
      new Map([
        ['a1', 100],
        ['a2', 20],
      ]),
    );
    const allocation = byAssetClass(positions);

    expect(allocation.map((slice) => slice.asset_class)).toEqual(['etf', 'bond']);
    expect(allocation[0].weight).toBeCloseTo(1000 / 1100, 10);
    expect(allocation.reduce((sum, slice) => sum + slice.weight, 0)).toBeCloseTo(1, 10);
  });

  it('returns nothing when no position has a price', () => {
    expect(byAssetClass([{ asset_class: 'etf', market_value: null }])).toEqual([]);
  });
});
