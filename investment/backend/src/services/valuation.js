import { getDatabase } from '../db/connection.js';
import { latestPrices } from './repository.js';

/**
 * Position and portfolio maths. Kept free of Express and of better-sqlite3
 * specifics so the same functions can be reused client-side against the
 * IndexedDB mirror when the browser is offline.
 */

export function positionValue(holding, price) {
  const quantity = holding.quantity ?? 0;
  const mark = price ?? null;
  const marketValue = mark === null ? null : quantity * mark;
  const costBasis = holding.cost_basis ?? 0;
  return {
    ...holding,
    price: mark,
    market_value: marketValue,
    cost_basis: costBasis,
    unrealized_gain: marketValue === null ? null : marketValue - costBasis,
    unrealized_gain_pct:
      marketValue === null || costBasis === 0 ? null : (marketValue - costBasis) / costBasis,
  };
}

export function holdingsFor(portfolioId, db = getDatabase()) {
  const rows = db
    .prepare('SELECT * FROM holdings WHERE portfolio_id = ? AND quantity > 0 ORDER BY symbol')
    .all(portfolioId);
  const priceByAsset = new Map(latestPrices(db).map((p) => [p.asset_id, p.close]));
  return rows.map((row) => positionValue(row, priceByAsset.get(row.asset_id) ?? null));
}

export function summarize(positions) {
  // A position with no synced price contributes nothing to market value but is
  // still reported, so the UI can flag the valuation as partial rather than
  // silently understating the portfolio.
  const priced = positions.filter((p) => p.market_value !== null);
  const marketValue = priced.reduce((sum, p) => sum + p.market_value, 0);
  const costBasis = priced.reduce((sum, p) => sum + p.cost_basis, 0);
  const income = positions.reduce((sum, p) => sum + (p.income || 0), 0);

  const allocation = priced
    .map((p) => ({
      symbol: p.symbol,
      asset_class: p.asset_class,
      market_value: p.market_value,
      weight: marketValue === 0 ? 0 : p.market_value / marketValue,
    }))
    .sort((a, b) => b.market_value - a.market_value);

  return {
    positions: positions.length,
    unpriced_positions: positions.length - priced.length,
    market_value: marketValue,
    cost_basis: costBasis,
    unrealized_gain: marketValue - costBasis,
    unrealized_gain_pct: costBasis === 0 ? null : (marketValue - costBasis) / costBasis,
    income,
    allocation,
  };
}

export function byAssetClass(positions) {
  const totals = new Map();
  for (const position of positions) {
    if (position.market_value === null) continue;
    totals.set(
      position.asset_class,
      (totals.get(position.asset_class) || 0) + position.market_value,
    );
  }
  const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
  return [...totals.entries()]
    .map(([asset_class, market_value]) => ({
      asset_class,
      market_value,
      weight: total === 0 ? 0 : market_value / total,
    }))
    .sort((a, b) => b.market_value - a.market_value);
}
