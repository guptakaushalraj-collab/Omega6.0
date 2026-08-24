-- Core schema for the offline-first investment manager.
--
-- Every user-editable row carries `updated_at` (ISO-8601 UTC) and a soft
-- `deleted_at`, because the sync endpoint reconciles by last-writer-wins on
-- `updated_at` and a hard DELETE would be invisible to a client that has been
-- offline since before the delete.

CREATE TABLE portfolios (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'USD',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE TABLE assets (
  id          TEXT PRIMARY KEY,
  symbol      TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  asset_class TEXT NOT NULL CHECK (asset_class IN ('equity','etf','bond','crypto','cash','other')),
  currency    TEXT NOT NULL DEFAULT 'USD',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);

CREATE TABLE transactions (
  id           TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  asset_id     TEXT NOT NULL REFERENCES assets(id),
  type         TEXT NOT NULL CHECK (type IN ('buy','sell','dividend')),
  quantity     REAL NOT NULL CHECK (quantity >= 0),
  price        REAL NOT NULL CHECK (price >= 0),
  fee          REAL NOT NULL DEFAULT 0 CHECK (fee >= 0),
  traded_at    TEXT NOT NULL,
  note         TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);

CREATE INDEX idx_transactions_portfolio ON transactions(portfolio_id, traded_at);
CREATE INDEX idx_transactions_asset ON transactions(asset_id);

-- Latest known mark for each asset. Offline clients keep serving the last
-- price they synced, so valuations degrade in staleness rather than vanishing.
CREATE TABLE prices (
  asset_id   TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  as_of      TEXT NOT NULL,
  close      REAL NOT NULL CHECK (close >= 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (asset_id, as_of)
);

-- Idempotency ledger. A queued client mutation carries an `op_id`; replaying
-- it after a flaky reconnect must not duplicate the transaction.
CREATE TABLE sync_ops (
  op_id       TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  status      TEXT NOT NULL,
  result_json TEXT,
  applied_at  TEXT NOT NULL
);

-- Append-only feed the client pulls with `?since=` to catch up on writes made
-- from other devices.
CREATE TABLE change_log (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  op         TEXT NOT NULL CHECK (op IN ('upsert','delete')),
  changed_at TEXT NOT NULL
);

CREATE INDEX idx_change_log_entity ON change_log(entity, seq);

-- Derived positions. Kept as a view so a holding can never drift out of sync
-- with the transactions it is computed from.
CREATE VIEW holdings AS
SELECT
  t.portfolio_id,
  t.asset_id,
  a.symbol,
  a.name,
  a.asset_class,
  a.currency,
  SUM(CASE t.type WHEN 'buy' THEN t.quantity WHEN 'sell' THEN -t.quantity ELSE 0 END) AS quantity,
  SUM(CASE t.type
        WHEN 'buy'  THEN  t.quantity * t.price + t.fee
        WHEN 'sell' THEN -(t.quantity * t.price - t.fee)
        ELSE 0 END) AS cost_basis,
  SUM(CASE t.type WHEN 'dividend' THEN t.quantity * t.price ELSE 0 END) AS income
FROM transactions t
JOIN assets a ON a.id = t.asset_id
WHERE t.deleted_at IS NULL AND a.deleted_at IS NULL
GROUP BY t.portfolio_id, t.asset_id;
