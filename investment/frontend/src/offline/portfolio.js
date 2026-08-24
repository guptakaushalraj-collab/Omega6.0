/**
 * Portfolio maths, computed from raw transactions.
 *
 * This is deliberately a pure module with no IndexedDB or fetch in it: the
 * dashboard runs these functions against the local mirror while offline, and
 * `tests/backend/parity.test.js` runs them against the same fixtures the
 * server's SQL `holdings` view sees, to prove the two agree. If you change a
 * formula here, change the view in database/migrations/001_init.sql too.
 */

const SIGN = { buy: 1, sell: -1, dividend: 0 };

export function computeHoldings(transactions, assets) {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const byAsset = new Map();

  for (const tx of transactions) {
    if (tx.deleted_at) continue;
    const asset = assetById.get(tx.asset_id);
    if (!asset || asset.deleted_at) continue;

    const key = tx.asset_id;
    if (!byAsset.has(key)) {
      byAsset.set(key, {
        asset_id: asset.id,
        portfolio_id: tx.portfolio_id,
        symbol: asset.symbol,
        name: asset.name,
        asset_class: asset.asset_class,
        currency: asset.currency,
        quantity: 0,
        cost_basis: 0,
        income: 0,
      });
    }

    const holding = byAsset.get(key);
    const quantity = Number(tx.quantity) || 0;
    const price = Number(tx.price) || 0;
    const fee = Number(tx.fee) || 0;

    holding.quantity += SIGN[tx.type] * quantity;
    if (tx.type === 'buy') holding.cost_basis += quantity * price + fee;
    else if (tx.type === 'sell') holding.cost_basis -= quantity * price - fee;
    else if (tx.type === 'dividend') holding.income += quantity * price;
  }

  return [...byAsset.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export function priceHoldings(holdings, priceByAssetId) {
  return holdings.map((holding) => {
    const price = priceByAssetId.get(holding.asset_id) ?? null;
    const marketValue = price === null ? null : holding.quantity * price;
    return {
      ...holding,
      price,
      market_value: marketValue,
      unrealized_gain: marketValue === null ? null : marketValue - holding.cost_basis,
      unrealized_gain_pct:
        marketValue === null || holding.cost_basis === 0
          ? null
          : (marketValue - holding.cost_basis) / holding.cost_basis,
    };
  });
}

export function summarize(positions) {
  const priced = positions.filter((p) => p.market_value !== null);
  const marketValue = priced.reduce((sum, p) => sum + p.market_value, 0);
  const costBasis = priced.reduce((sum, p) => sum + p.cost_basis, 0);
  return {
    positions: positions.length,
    unpriced_positions: positions.length - priced.length,
    market_value: marketValue,
    cost_basis: costBasis,
    unrealized_gain: marketValue - costBasis,
    unrealized_gain_pct: costBasis === 0 ? null : (marketValue - costBasis) / costBasis,
    income: positions.reduce((sum, p) => sum + (p.income || 0), 0),
  };
}

export function byAssetClass(positions) {
  const totals = new Map();
  for (const position of positions) {
    if (position.market_value === null) continue;
    totals.set(position.asset_class, (totals.get(position.asset_class) || 0) + position.market_value);
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
