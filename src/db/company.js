const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const schema = fs.readFileSync(path.join(__dirname, 'schema_company.sql'), 'utf8');
const cache = new Map();

function hasTable(db, name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
  return Boolean(row);
}

function hasColumn(db, table, column) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  return columns.some((col) => col.name === column);
}

function ensureSchema(db) {
  // Ensure divisions table exists
  db.exec(`CREATE TABLE IF NOT EXISTS divisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT
  );`);

  // Ensure item_groups has division_id
  if (hasTable(db, 'item_groups') && !hasColumn(db, 'item_groups', 'division_id')) {
    db.exec('ALTER TABLE item_groups ADD COLUMN division_id INTEGER');
  }

  // Ensure user_divisions table exists
  db.exec(`CREATE TABLE IF NOT EXISTS user_divisions (
    user_id INTEGER NOT NULL,
    division_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, division_id)
  );`);

  // Ensure opening_balances table exists
  db.exec(`CREATE TABLE IF NOT EXISTS opening_balances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    qty REAL NOT NULL,
    price_per_unit REAL,
    note TEXT,
    opening_date TEXT NOT NULL,
    created_by INTEGER,
    created_at TEXT NOT NULL
  );`);

  // Seed default division if empty
  const divisionCount = db.prepare('SELECT COUNT(*) as count FROM divisions').get().count;
  if (divisionCount === 0) {
    db.prepare('INSERT INTO divisions (name, description) VALUES (?, ?)').run('Umum', 'Default');
  }

  // Assign division_id for existing groups
  const defaultDivision = db.prepare('SELECT id FROM divisions ORDER BY id ASC LIMIT 1').get();
  if (defaultDivision) {
    db.prepare('UPDATE item_groups SET division_id = ? WHERE division_id IS NULL').run(defaultDivision.id);
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_groups_division_id ON item_groups(division_id);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_divisions_user_id ON user_divisions(user_id);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_opening_item_id ON opening_balances(item_id);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_opening_date ON opening_balances(opening_date);');
}

function initDb(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(schema);
  ensureSchema(db);
  return db;
}

function getCompanyDb(dbPath) {
  if (cache.has(dbPath)) return cache.get(dbPath);
  const db = initDb(dbPath);
  cache.set(dbPath, db);
  return db;
}

function createCompanyDb(dbPath) {
  return initDb(dbPath);
}

function closeCompanyDb(dbPath) {
  const db = cache.get(dbPath);
  if (!db) return;
  try {
    db.close();
  } catch (err) {
    // ignore close errors
  }
  cache.delete(dbPath);
}

module.exports = { getCompanyDb, createCompanyDb, closeCompanyDb };
