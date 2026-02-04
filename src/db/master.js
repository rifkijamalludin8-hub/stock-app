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

function hasColumn(table, column) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  return columns.some((col) => col.name === column);
}

if (!hasColumn('companies', 'logo_path')) {
  db.exec('ALTER TABLE companies ADD COLUMN logo_path TEXT');
}

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
    'INSERT INTO companies (name, slug, db_path, logo_path, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  const info = stmt.run(name, slug, dbPath, null, now);
  return getCompanyById(info.lastInsertRowid);
}

function updateCompanyLogo(id, logoPath) {
  return db.prepare('UPDATE companies SET logo_path = ? WHERE id = ?').run(logoPath, id);
}

function deleteCompanyById(id) {
  return db.prepare('DELETE FROM companies WHERE id = ?').run(id);
}

module.exports = {
  dataDir,
  companiesDir,
  listCompanies,
  getCompanyById,
  getCompanyBySlug,
  createCompany,
  deleteCompanyById,
  updateCompanyLogo,
};
