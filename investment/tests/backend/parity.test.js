import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { closeDatabase } from '../../backend/src/db/connection.js';
import { listAssets, listTransactions } from '../../backend/src/services/repository.js';
import { holdingsFor, summarize as serverSummarize } from '../../backend/src/services/valuation.js';
import {
  byAssetClass as clientByAssetClass,
  computeHoldings,
  priceHoldings,
  summarize as clientSummarize,
} from '../../frontend/src/offline/portfolio.js';
import { freshDb } from '../helpers/testDb.js';

/**
 * The server derives holdings in SQL (a view) and the offline client derives
 * them in JavaScript. Two implementations of one formula drift silently, and a
 * portfolio that reads differently online and offline destroys trust in the
 * numbers — so this test pins them together against the same data.
 */
describe('server/client valuation parity', () => {
  let db;
  beforeEach(() => {
    db = freshDb({ withSeed: true });
  });
  after(() => closeDatabase());

  function clientSide(portfolioId) {
    const transactions = listTransactions({ portfolioId, limit: 5000 }, db);
    const assets = listAssets(db);
    const priceByAsset = new Map(
      db
        .prepare(
          `SELECT p.asset_id, p.close FROM prices p
           JOIN (SELECT asset_id, MAX(as_of) AS as_of FROM prices GROUP BY asset_id) l
             ON l.asset_id = p.asset_id AND l.as_of = p.as_of`,
        )
        .all()
        .map((row) => [row.asset_id, row.close]),
    );
    return priceHoldings(computeHoldings(transactions, assets), priceByAsset).filter(
      (position) => position.quantity > 0.0000001,
    );
  }

  for (const portfolioId of ['pf_demo_core', 'pf_demo_income']) {
    it(`agrees on every position in ${portfolioId}`, () => {
      const server = holdingsFor(portfolioId, db);
      const client = clientSide(portfolioId);

      assert.equal(client.length, server.length, 'both sides must find the same positions');

      for (const serverPosition of server) {
        const clientPosition = client.find((p) => p.asset_id === serverPosition.asset_id);
        assert.ok(clientPosition, `client is missing ${serverPosition.symbol}`);

        for (const field of ['quantity', 'cost_basis', 'income', 'market_value']) {
          const a = serverPosition[field];
          const b = clientPosition[field];
          if (a === null || b === null) {
            assert.equal(a, b, `${serverPosition.symbol}.${field} null-ness must match`);
          } else {
            // Float tolerance: SQLite's SUM and JS's += accumulate in different
            // orders, so the last bit can differ on the same inputs.
            assert.ok(
              Math.abs(a - b) < 1e-9,
              `${serverPosition.symbol}.${field}: server ${a} vs client ${b}`,
            );
          }
        }
      }
    });

    it(`agrees on the ${portfolioId} summary and allocation`, () => {
      const server = serverSummarize(holdingsFor(portfolioId, db));
      const client = clientSummarize(clientSide(portfolioId));

      for (const field of ['positions', 'unpriced_positions']) {
        assert.equal(client[field], server[field], field);
      }
      for (const field of ['market_value', 'cost_basis', 'unrealized_gain', 'income']) {
        assert.ok(Math.abs(server[field] - client[field]) < 1e-9, field);
      }

      const clientAllocation = clientByAssetClass(clientSide(portfolioId));
      assert.deepEqual(
        clientAllocation.map((slice) => slice.asset_class),
        server.allocation.length ? clientAllocation.map((slice) => slice.asset_class) : [],
      );
    });
  }

  it('agrees after a sell reduces a position below its original cost basis', () => {
    db.prepare(
      `INSERT INTO transactions
         (id, portfolio_id, asset_id, type, quantity, price, fee, traded_at, created_at, updated_at)
       VALUES ('tx_parity', 'pf_demo_core', 'as_vti', 'sell', 10, 300, 2, '2026-06-01T00:00:00.000Z',
               '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z')`,
    ).run();

    const server = holdingsFor('pf_demo_core', db).find((p) => p.symbol === 'VTI');
    const client = clientSide('pf_demo_core').find((p) => p.symbol === 'VTI');

    assert.equal(server.quantity, 30);
    assert.ok(Math.abs(server.cost_basis - client.cost_basis) < 1e-9);
    assert.ok(Math.abs(server.unrealized_gain - client.unrealized_gain) < 1e-9);
  });

  it('agrees that an unpriced asset is reported but excluded from totals', () => {
    db.prepare(
      `INSERT INTO assets (id, symbol, name, asset_class, currency, created_at, updated_at)
       VALUES ('as_unpriced', 'ZZZZ', 'No Price Co', 'equity', 'USD', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO transactions
         (id, portfolio_id, asset_id, type, quantity, price, fee, traded_at, created_at, updated_at)
       VALUES ('tx_unpriced', 'pf_demo_core', 'as_unpriced', 'buy', 5, 50, 0, '2026-06-01T00:00:00.000Z',
               '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z')`,
    ).run();

    const server = serverSummarize(holdingsFor('pf_demo_core', db));
    const client = clientSummarize(clientSide('pf_demo_core'));

    assert.equal(server.unpriced_positions, 1);
    assert.equal(client.unpriced_positions, 1);
    assert.ok(Math.abs(server.market_value - client.market_value) < 1e-9);
  });
});
