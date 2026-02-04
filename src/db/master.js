const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');
const companiesDir = path.join(dataDir, 'companies');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(companiesDir)) fs.mkdirSync(companiesDir, { recursive: true });

const masterPath = path.join(dataDir, 'master.db');
const db = new Database(masterPath);

db.pragma('journal_mode = WAL');

const schema = fs.readFileSync(path.join(__dirname, 'schema_master.sql'), 'utf8');
db.exec(schema);

function listCompanies() {
  return db.prepare('SELECT * FROM companies ORDER BY name ASC').all();
}

function getCompanyById(id) {
  return db.prepare('SELECT * FROM companies WHERE id = ?').get(id);
}

function getCompanyBySlug(slug) {
  return db.prepare('SELECT * FROM companies WHERE slug = ?').get(slug);
}

function createCompany({ name, slug, dbPath }) {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    'INSERT INTO companies (name, slug, db_path, created_at) VALUES (?, ?, ?, ?)'
  );
  const info = stmt.run(name, slug, dbPath, now);
  return getCompanyById(info.lastInsertRowid);
}

module.exports = {
  dataDir,
  companiesDir,
  listCompanies,
  getCompanyById,
  getCompanyBySlug,
  createCompany,
};
