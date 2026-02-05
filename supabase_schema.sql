CREATE TABLE IF NOT EXISTS companies (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  logo_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','user')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, email)
);

CREATE TABLE IF NOT EXISTS divisions (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS item_groups (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  division_id BIGINT NOT NULL REFERENCES divisions(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT,
  UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS items (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  group_id BIGINT NOT NULL REFERENCES item_groups(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  sku TEXT,
  unit TEXT,
  expiry_date DATE,
  min_stock NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('IN','OUT')),
  qty NUMERIC NOT NULL,
  price_per_unit NUMERIC,
  proof_path TEXT,
  note TEXT,
  txn_date DATE NOT NULL,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS adjustments (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  qty_delta NUMERIC NOT NULL,
  proof_path TEXT,
  note TEXT,
  adj_date DATE NOT NULL,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS opening_balances (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  qty NUMERIC NOT NULL,
  price_per_unit NUMERIC,
  note TEXT,
  opening_date DATE NOT NULL,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_divisions (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  division_id BIGINT NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, division_id)
);

CREATE INDEX IF NOT EXISTS idx_items_company ON items(company_id);
CREATE INDEX IF NOT EXISTS idx_groups_company ON item_groups(company_id);
CREATE INDEX IF NOT EXISTS idx_divisions_company ON divisions(company_id);
CREATE INDEX IF NOT EXISTS idx_transactions_company ON transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_adjustments_company ON adjustments(company_id);
CREATE INDEX IF NOT EXISTS idx_opening_company ON opening_balances(company_id);
CREATE INDEX IF NOT EXISTS idx_user_divisions_user ON user_divisions(user_id);
