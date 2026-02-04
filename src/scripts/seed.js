const path = require('path');
const { createCompany, listCompanies, companiesDir } = require('../db/master');
const { createCompanyDb } = require('../db/company');
const { slugify } = require('../utils/slug');
const { hashPassword } = require('../utils/auth');
const { nowIso } = require('../utils/date');

async function run() {
  const existing = listCompanies();
  if (existing.length > 0) {
    console.log('Companies already exist. Seed skipped.');
    return;
  }

  const name = process.argv[2] || 'Demo Company';
  const email = process.argv[3] || 'user@demo.com';
  const password = process.argv[4] || 'password123';
  const slug = slugify(name) || 'demo-company';
  const dbPath = path.join(companiesDir, `${slug}.db`);

  createCompany({ name, slug, dbPath });
  const db = createCompanyDb(dbPath);

  const passwordHash = await hashPassword(password);
  db.prepare(
    'INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run('User Demo', email, passwordHash, 'user', nowIso());

  console.log('Seeded company and user');
  console.log('Company:', name);
  console.log('Email:', email);
  console.log('Password:', password);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
