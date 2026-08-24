import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import morgan from 'morgan';
import { getDatabase } from './db/connection.js';
import assetsRouter from './routes/assets.js';
import portfoliosRouter from './routes/portfolios.js';
import syncRouter from './routes/sync.js';
import transactionsRouter from './routes/transactions.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FRONTEND_DIST = path.join(PROJECT_ROOT, 'frontend/dist');

/**
 * Serves the built PWA from the same origin as the API.
 *
 * This is what makes the production deployment work at all: a service worker
 * can only control pages within its own scope, so shipping the client from a
 * different host than /api would leave the app permanently online-only.
 */
function mountFrontend(app) {
  if (!fs.existsSync(path.join(FRONTEND_DIST, 'index.html'))) return false;

  app.use(
    express.static(FRONTEND_DIST, {
      setHeaders(res, filePath) {
        // The worker must be revalidated on every load, or a stale copy will
        // keep serving an old shell long after a deploy.
        if (filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
        // Everything else is content-hashed by Vite and safe to pin.
        else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );

  // SPA fallback, but only for navigations — an unmatched /api/* must still
  // 404 as JSON rather than quietly returning the HTML shell.
  app.get(/^\/(?!api\/).*/, (req, res, next) => {
    if (!req.accepts('html')) return next();
    return res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  });

  return true;
}

export function createApp({ logger = process.env.NODE_ENV !== 'test' } = {}) {
  const app = express();

  app.use(express.json({ limit: '2mb' }));
  app.use(
    cors({
      origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((o) => o.trim()),
    }),
  );
  if (logger) app.use(morgan('dev'));

  // The service worker probes this before draining the offline queue, so it
  // must stay cheap and must not depend on any table existing yet.
  app.get('/api/health', (req, res) => {
    let database = 'ok';
    try {
      getDatabase().prepare('SELECT 1').get();
    } catch (error) {
      database = `error: ${error.message}`;
    }
    res.status(database === 'ok' ? 200 : 503).json({
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      time: new Date().toISOString(),
    });
  });

  app.use('/api/portfolios', portfoliosRouter);
  app.use('/api/assets', assetsRouter);
  app.use('/api/transactions', transactionsRouter);
  app.use('/api/sync', syncRouter);

  mountFrontend(app);

  app.use((req, res) => res.status(404).json({ error: `no route for ${req.method} ${req.path}` }));

  // Express identifies error middleware by arity, so the fourth argument has
  // to stay even though it is never called.
  app.use((error, req, res, _next) => {
    if (process.env.NODE_ENV !== 'test') console.error(error);
    res.status(error.status || 500).json({ error: error.message || 'internal error' });
  });

  return app;
}
