const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const schema = fs.readFileSync(path.join(__dirname, 'schema_company.sql'), 'utf8');
const cache = new Map();

function initDb(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(schema);
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

module.exports = { getCompanyDb, createCompanyDb };
