import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { createApp } from '../../backend/src/app.js';
import { closeDatabase } from '../../backend/src/db/connection.js';
import { freshDb } from '../helpers/testDb.js';

process.env.NODE_ENV = 'test';

describe('HTTP API', () => {
  let app;
  beforeEach(() => {
    freshDb({ withSeed: true });
    app = createApp({ logger: false });
  });
  after(() => closeDatabase());

  it('reports health', async () => {
    const response = await request(app).get('/api/health').expect(200);
    assert.equal(response.body.status, 'ok');
    assert.equal(response.body.database, 'ok');
  });

  it('lists seeded portfolios', async () => {
    const response = await request(app).get('/api/portfolios').expect(200);
    assert.equal(response.body.portfolios.length, 2);
  });

  it('creates a portfolio and rejects a nameless one', async () => {
    const created = await request(app).post('/api/portfolios').send({ name: 'Roth' }).expect(201);
    assert.equal(created.body.portfolio.name, 'Roth');

    const rejected = await request(app).post('/api/portfolios').send({}).expect(400);
    assert.match(rejected.body.error, /name is required/);
  });

  it('404s on an unknown portfolio rather than returning an empty object', async () => {
    const response = await request(app).get('/api/portfolios/pf_nope').expect(404);
    assert.match(response.body.error, /not found/);
  });

  it('computes holdings with market values from the seeded prices', async () => {
    const response = await request(app).get('/api/portfolios/pf_demo_core/holdings').expect(200);
    const aapl = response.body.holdings.find((h) => h.symbol === 'AAPL');

    // Seed: bought 25 @ 214.75 (+1 fee), sold 5 @ 236.20 (+1 fee) => 20 shares.
    assert.equal(aapl.quantity, 20);
    assert.equal(aapl.price, 242.15);
    assert.ok(Math.abs(aapl.market_value - 20 * 242.15) < 1e-9);
    assert.ok(response.body.summary.market_value > 0);
    assert.equal(response.body.summary.unpriced_positions, 0);
    assert.ok(response.body.allocation.length > 0);
  });

  it('validates transactions the same way the sync queue does', async () => {
    const response = await request(app)
      .post('/api/transactions')
      .send({ portfolio_id: 'pf_demo_core', asset_id: 'as_vti', type: 'gift', quantity: 1, price: 1 })
      .expect(400);
    assert.match(response.body.error, /type must be one of/);
  });

  it('round-trips a transaction through create, update and delete', async () => {
    const created = await request(app)
      .post('/api/transactions')
      .send({ portfolio_id: 'pf_demo_core', asset_id: 'as_vti', type: 'buy', quantity: 2, price: 300 })
      .expect(201);
    const { id } = created.body.transaction;

    const updated = await request(app)
      .put(`/api/transactions/${id}`)
      .send({ portfolio_id: 'pf_demo_core', asset_id: 'as_vti', type: 'buy', quantity: 4, price: 300 })
      .expect(200);
    assert.equal(updated.body.transaction.quantity, 4);

    await request(app).delete(`/api/transactions/${id}`).expect(204);
    await request(app).delete(`/api/transactions/${id}`).expect(404);
  });

  it('returns 207 when part of a queued batch is rejected', async () => {
    const response = await request(app)
      .post('/api/sync')
      .send({
        client_id: 'client-a',
        operations: [
          { op_id: 'ok-1', type: 'asset.upsert', payload: { symbol: 'NVDA' } },
          { op_id: 'bad-1', type: 'transaction.upsert', payload: { quantity: 1 } },
        ],
      })
      .expect(207);

    assert.equal(response.body.applied, 1);
    assert.equal(response.body.rejected, 1);
    assert.equal(response.body.results.length, 2);
  });

  it('returns 200 and no duplicates when a whole batch succeeds, then 200 on replay', async () => {
    const batch = {
      client_id: 'client-a',
      operations: [{ op_id: 'once-1', type: 'asset.upsert', payload: { symbol: 'TSLA' } }],
    };
    const first = await request(app).post('/api/sync').send(batch).expect(200);
    assert.equal(first.body.applied, 1);

    const replay = await request(app).post('/api/sync').send(batch).expect(200);
    assert.equal(replay.body.applied, 0);
    assert.equal(replay.body.duplicates, 1);
  });

  it('serves a snapshot a cold client can boot from', async () => {
    const response = await request(app).get('/api/sync/snapshot').expect(200);
    assert.ok(response.body.portfolios.length >= 2);
    assert.ok(response.body.assets.length >= 6);
    assert.ok(response.body.transactions.length >= 9);
    assert.ok(response.body.prices.length >= 6);
  });

  it('400s a sync without a client_id', async () => {
    const response = await request(app).post('/api/sync').send({ operations: [] }).expect(400);
    assert.match(response.body.error, /client_id is required/);
    assert.ok(Array.isArray(response.body.supported));
  });

  it('404s an unknown route with a JSON body, not an HTML error page', async () => {
    const response = await request(app).get('/api/nope').expect(404);
    assert.match(response.body.error, /no route for GET/);
  });

  it('never lets the SPA fallback swallow an unknown /api path', async () => {
    // Regression guard: a catch-all that also matched /api/* would answer every
    // typo'd endpoint with the HTML shell, and the client would try to JSON.parse
    // "<!doctype html>" instead of surfacing a clear 404.
    for (const path of ['/api/nope', '/api/portfolios/pf_x/nope', '/api/sync/nope']) {
      const response = await request(app).get(path).set('Accept', 'text/html').expect(404);
      assert.ok(
        !String(response.text).startsWith('<!doctype'),
        `${path} must not return the SPA shell`,
      );
    }
  });
});
