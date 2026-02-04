const express = require('express');
const path = require('path');
const fs = require('fs');
const {
  listCompanies,
  createCompany,
  getCompanyById,
  companiesDir,
  deleteCompanyById,
} = require('../db/master');
const { createCompanyDb, getCompanyDb, closeCompanyDb } = require('../db/company');
const { slugify } = require('../utils/slug');
const { hashPassword, comparePassword } = require('../utils/auth');
const { setFlash } = require('../utils/flash');
const { nowIso } = require('../utils/date');

const router = express.Router();

function isSetupKeyValid(req) {
  if (!process.env.SETUP_KEY) return true;
  return req.body.setup_key === process.env.SETUP_KEY;
}

router.get('/select-company', (req, res) => {
  const companies = listCompanies();
  res.render('pages/select-company', { companies });
});

router.get('/setup', (req, res) => {
  const companies = listCompanies();
  if (companies.length > 0) return res.redirect('/select-company');
  res.render('pages/setup');
});

router.post('/setup', async (req, res) => {
  const companies = listCompanies();
  if (companies.length > 0) return res.redirect('/select-company');
  if (!isSetupKeyValid(req)) {
    setFlash(req, 'error', 'Setup key salah.');
    return res.redirect('/setup');
  }

  const { company_name, company_slug, user_name, email, password, role } = req.body;
  if (!company_name || !email || !password) {
    setFlash(req, 'error', 'Semua field wajib diisi.');
    return res.redirect('/setup');
  }

  const slug = slugify(company_slug || company_name) || 'perusahaan';
  const dbPath = path.join(companiesDir, `${slug}.db`);

  const company = createCompany({ name: company_name, slug, dbPath });
  const db = createCompanyDb(dbPath);
  const passwordHash = await hashPassword(password);
  db.prepare(
    'INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(user_name || 'Pemilik', email, passwordHash, role || 'user', nowIso());

  setFlash(req, 'success', 'Perusahaan dan user pertama berhasil dibuat.');
  res.redirect(`/login?company=${company.id}`);
});

router.post('/companies', async (req, res) => {
  const { mode, name, slug: slugInput, db_path, user_name, email, password, role } = req.body;
  if (!name) {
    setFlash(req, 'error', 'Nama perusahaan wajib diisi.');
    return res.redirect('/select-company');
  }
  if (!isSetupKeyValid(req)) {
    setFlash(req, 'error', 'Setup key salah.');
    return res.redirect('/select-company');
  }
  if (mode === 'create' && (!email || !password)) {
    setFlash(req, 'error', 'Email dan password wajib diisi untuk user pertama.');
    return res.redirect('/select-company');
  }

  const slugBase = slugify(slugInput || name) || 'perusahaan';
  let slug = slugBase;
  let attempt = 1;
  while (listCompanies().some((c) => c.slug === slug)) {
    attempt += 1;
    slug = `${slugBase}-${attempt}`;
  }

  let dbPath = db_path;
  if (mode === 'create') {
    dbPath = path.join(companiesDir, `${slug}.db`);
  } else if (!dbPath) {
    setFlash(req, 'error', 'Path database wajib diisi untuk koneksi.');
    return res.redirect('/select-company');
  }

  if (mode === 'connect' && !fs.existsSync(dbPath)) {
    setFlash(req, 'error', 'File database tidak ditemukan.');
    return res.redirect('/select-company');
  }

  const company = createCompany({ name, slug, dbPath });
  const db = getCompanyDb(dbPath);

  if (mode === 'create') {
    const passwordHash = await hashPassword(password);
    db.prepare(
      'INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(user_name || 'User Utama', email, passwordHash, role || 'user', nowIso());
  }

  setFlash(req, 'success', 'Perusahaan berhasil ditambahkan.');
  res.redirect(`/login?company=${company.id}`);
});

router.post('/companies/delete', (req, res) => {
  if (!isSetupKeyValid(req)) {
    setFlash(req, 'error', 'Setup key salah.');
    return res.redirect('/select-company');
  }

  const companyId = Number(req.body.company_id);
  if (!companyId) {
    setFlash(req, 'error', 'Perusahaan tidak ditemukan.');
    return res.redirect('/select-company');
  }

  const company = getCompanyById(companyId);
  if (!company) {
    setFlash(req, 'error', 'Perusahaan tidak ditemukan.');
    return res.redirect('/select-company');
  }

  try {
    closeCompanyDb(company.db_path);
    if (fs.existsSync(company.db_path)) {
      fs.unlinkSync(company.db_path);
    }
    deleteCompanyById(companyId);
    if (req.session.companyId === companyId) {
      req.session.companyId = null;
      req.session.user = null;
    }
    setFlash(req, 'success', 'Perusahaan berhasil dihapus.');
  } catch (err) {
    setFlash(req, 'error', 'Gagal menghapus perusahaan.');
  }

  res.redirect('/select-company');
});

router.get('/login', (req, res) => {
  if (req.query.company) req.session.companyId = Number(req.query.company);
  if (!req.session.companyId) return res.redirect('/select-company');
  const company = getCompanyById(req.session.companyId);
  if (!company) {
    req.session.companyId = null;
    return res.redirect('/select-company');
  }
  res.render('pages/login', { company });
});

router.post('/login', async (req, res) => {
  if (!req.session.companyId) return res.redirect('/select-company');
  const company = getCompanyById(req.session.companyId);
  if (!company) return res.redirect('/select-company');

  const db = getCompanyDb(company.db_path);
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    setFlash(req, 'error', 'Email atau password salah.');
    return res.redirect('/login');
  }

  const match = await comparePassword(password, user.password_hash);
  if (!match) {
    setFlash(req, 'error', 'Email atau password salah.');
    return res.redirect('/login');
  }

  req.session.user = { id: user.id, name: user.name, role: user.role, email: user.email };
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  req.session.user = null;
  res.redirect('/login');
});

module.exports = router;
