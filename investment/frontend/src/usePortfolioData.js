import { useMemo } from 'react';
import { useData } from './offline/DataProvider.jsx';
import { byAssetClass, computeHoldings, priceHoldings, summarize } from './offline/portfolio.js';

/**
 * Derives positions from the local mirror. Note there is no fetch here: the
 * dashboard is computed from IndexedDB whether or not the network is up.
 */
export function usePortfolioData(portfolioId) {
  const { portfolios, assets, transactions, prices } = useData();

  return useMemo(() => {
    const scoped = portfolioId
      ? transactions.filter((tx) => tx.portfolio_id === portfolioId)
      : transactions;

    // prices may hold several dates per asset; keep the newest per asset.
    const latest = new Map();
    for (const price of prices) {
      const current = latest.get(price.asset_id);
      if (!current || price.as_of > current.as_of) latest.set(price.asset_id, price);
    }
    const priceByAsset = new Map([...latest].map(([assetId, price]) => [assetId, price.close]));

    const positions = priceHoldings(computeHoldings(scoped, assets), priceByAsset).filter(
      (position) => position.quantity > 0.0000001,
    );

    return {
      portfolio: portfolios.find((p) => p.id === portfolioId) || null,
      holdings: positions,
      summary: summarize(positions),
      allocation: byAssetClass(positions),
    };
  }, [portfolioId, portfolios, assets, transactions, prices]);
}
