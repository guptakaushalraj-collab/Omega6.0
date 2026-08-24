import process from 'node:process';
import { createApp } from './app.js';
import { closeDatabase, getDatabase, resolveDatabaseFile } from './db/connection.js';

const port = Number(process.env.PORT) || 4000;
const app = createApp();

try {
  getDatabase().prepare('SELECT 1 FROM portfolios LIMIT 1').get();
} catch {
  console.error(
    `No schema found in ${resolveDatabaseFile()}. Run "npm run db:migrate" (or "npm run db:reset" for demo data) first.`,
  );
  process.exit(1);
}

const server = app.listen(port, () => {
  console.log(`API listening on http://localhost:${port} (db: ${resolveDatabaseFile()})`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
  });
}
