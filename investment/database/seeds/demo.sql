-- Demo data. Safe to re-run: every insert is an upsert on the primary key.

INSERT INTO portfolios (id, name, base_currency, created_at, updated_at) VALUES
  ('pf_demo_core',   'Core Long-Term', 'USD', '2026-01-02T09:00:00.000Z', '2026-01-02T09:00:00.000Z'),
  ('pf_demo_income', 'Dividend Income','USD', '2026-01-02T09:00:00.000Z', '2026-01-02T09:00:00.000Z')
ON CONFLICT(id) DO NOTHING;

INSERT INTO assets (id, symbol, name, asset_class, currency, created_at, updated_at) VALUES
  ('as_vti',  'VTI',  'Vanguard Total Stock Market ETF', 'etf',    'USD', '2026-01-02T09:00:00.000Z', '2026-01-02T09:00:00.000Z'),
  ('as_vxus', 'VXUS', 'Vanguard Total International ETF','etf',    'USD', '2026-01-02T09:00:00.000Z', '2026-01-02T09:00:00.000Z'),
  ('as_bnd',  'BND',  'Vanguard Total Bond Market ETF',  'bond',   'USD', '2026-01-02T09:00:00.000Z', '2026-01-02T09:00:00.000Z'),
  ('as_aapl', 'AAPL', 'Apple Inc.',                      'equity', 'USD', '2026-01-02T09:00:00.000Z', '2026-01-02T09:00:00.000Z'),
  ('as_msft', 'MSFT', 'Microsoft Corporation',           'equity', 'USD', '2026-01-02T09:00:00.000Z', '2026-01-02T09:00:00.000Z'),
  ('as_ko',   'KO',   'The Coca-Cola Company',           'equity', 'USD', '2026-01-02T09:00:00.000Z', '2026-01-02T09:00:00.000Z')
ON CONFLICT(id) DO NOTHING;

INSERT INTO transactions (id, portfolio_id, asset_id, type, quantity, price, fee, traded_at, note, created_at, updated_at) VALUES
  ('tx_demo_01', 'pf_demo_core',   'as_vti',  'buy',      40, 268.40, 0.00, '2026-01-06T14:30:00.000Z', 'Opening position',   '2026-01-06T14:30:00.000Z', '2026-01-06T14:30:00.000Z'),
  ('tx_demo_02', 'pf_demo_core',   'as_vxus', 'buy',      75,  64.10, 0.00, '2026-01-06T14:32:00.000Z', NULL,                 '2026-01-06T14:32:00.000Z', '2026-01-06T14:32:00.000Z'),
  ('tx_demo_03', 'pf_demo_core',   'as_bnd',  'buy',      60,  73.55, 0.00, '2026-01-06T14:35:00.000Z', NULL,                 '2026-01-06T14:35:00.000Z', '2026-01-06T14:35:00.000Z'),
  ('tx_demo_04', 'pf_demo_core',   'as_aapl', 'buy',      25, 214.75, 1.00, '2026-02-11T15:05:00.000Z', NULL,                 '2026-02-11T15:05:00.000Z', '2026-02-11T15:05:00.000Z'),
  ('tx_demo_05', 'pf_demo_core',   'as_aapl', 'sell',      5, 236.20, 1.00, '2026-05-19T15:40:00.000Z', 'Trimmed on strength','2026-05-19T15:40:00.000Z', '2026-05-19T15:40:00.000Z'),
  ('tx_demo_06', 'pf_demo_core',   'as_msft', 'buy',      12, 421.30, 1.00, '2026-03-04T15:10:00.000Z', NULL,                 '2026-03-04T15:10:00.000Z', '2026-03-04T15:10:00.000Z'),
  ('tx_demo_07', 'pf_demo_income', 'as_ko',   'buy',     120,  63.90, 0.00, '2026-01-20T15:00:00.000Z', NULL,                 '2026-01-20T15:00:00.000Z', '2026-01-20T15:00:00.000Z'),
  ('tx_demo_08', 'pf_demo_income', 'as_ko',   'dividend',120,   0.51, 0.00, '2026-04-01T12:00:00.000Z', 'Q1 dividend',        '2026-04-01T12:00:00.000Z', '2026-04-01T12:00:00.000Z'),
  ('tx_demo_09', 'pf_demo_income', 'as_bnd',  'buy',     140,  73.20, 0.00, '2026-02-03T15:00:00.000Z', NULL,                 '2026-02-03T15:00:00.000Z', '2026-02-03T15:00:00.000Z')
ON CONFLICT(id) DO NOTHING;

INSERT INTO prices (asset_id, as_of, close, created_at) VALUES
  ('as_vti',  '2026-08-21', 291.66, '2026-08-21T21:00:00.000Z'),
  ('as_vxus', '2026-08-21',  69.42, '2026-08-21T21:00:00.000Z'),
  ('as_bnd',  '2026-08-21',  74.88, '2026-08-21T21:00:00.000Z'),
  ('as_aapl', '2026-08-21', 242.15, '2026-08-21T21:00:00.000Z'),
  ('as_msft', '2026-08-21', 447.90, '2026-08-21T21:00:00.000Z'),
  ('as_ko',   '2026-08-21',  66.05, '2026-08-21T21:00:00.000Z')
ON CONFLICT(asset_id, as_of) DO UPDATE SET close = excluded.close;
