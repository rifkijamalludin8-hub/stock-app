const express = require('express');
const {
  listCompanies,
  createCompany,
  getCompanyById,
  deleteCompanyById,
} = require('../db/master');
const { query } = require('../db/pg');
const { slugify } = require('../utils/slug');
const { hashPassword, comparePassword } = require('../utils/auth');
const { setFlash } = require('../utils/flash');
const { nowIso } = require('../utils/date');

const router = express.Router();

function isSetupKeyValid(req) {
  if (!process.env.SETUP_KEY) return true;
  return req.body.setup_key === process.env.SETUP_KEY;
}

router.get('/select-company', async (req, res) => {
  const companies = await listCompanies();
  res.render('pages/select-company', { companies });
});

router.get('/setup', async (req, res) => {
  const companies = await listCompanies();
  if (companies.length > 0) return res.redirect('/select-company');
  res.render('pages/setup');
});

router.post('/setup', async (req, res) => {
  const companies = await listCompanies();
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

  const company = await createCompany({ name: company_name, slug });
  await query('INSERT INTO divisions (company_id, name, description) VALUES ($1, $2, $3)', [
    company.id,
    'Umum',
    'Default',
  ]);
  const passwordHash = await hashPassword(password);
  await query(
    'INSERT INTO users (company_id, name, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [company.id, user_name || 'Pemilik', email, passwordHash, role || 'user', nowIso()]
  );

  setFlash(req, 'success', 'Perusahaan dan user pertama berhasil dibuat.');
  res.redirect(`/login?company=${company.id}`);
});

router.post('/companies', async (req, res) => {
  const { name, slug: slugInput, user_name, email, password, role } = req.body;
  if (!name) {
    setFlash(req, 'error', 'Nama perusahaan wajib diisi.');
    return res.redirect('/select-company');
  }
  if (!isSetupKeyValid(req)) {
    setFlash(req, 'error', 'Setup key salah.');
    return res.redirect('/select-company');
  }
  if (!email || !password) {
    setFlash(req, 'error', 'Email dan password wajib diisi untuk user pertama.');
    return res.redirect('/select-company');
  }

  const slugBase = slugify(slugInput || name) || 'perusahaan';
  let slug = slugBase;
  let attempt = 1;
  const existing = await listCompanies();
  while (existing.some((c) => c.slug === slug)) {
    attempt += 1;
    slug = `${slugBase}-${attempt}`;
  }

  const company = await createCompany({ name, slug });
  await query('INSERT INTO divisions (company_id, name, description) VALUES ($1, $2, $3)', [
    company.id,
    'Umum',
    'Default',
  ]);
  const passwordHash = await hashPassword(password);
  await query(
    'INSERT INTO users (company_id, name, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [company.id, user_name || 'User Utama', email, passwordHash, role || 'user', nowIso()]
  );

  setFlash(req, 'success', 'Perusahaan berhasil ditambahkan.');
  res.redirect(`/login?company=${company.id}`);
});

router.post('/companies/delete', async (req, res) => {
  if (!isSetupKeyValid(req)) {
    setFlash(req, 'error', 'Setup key salah.');
    return res.redirect('/select-company');
  }

  const companyId = Number(req.body.company_id);
  if (!companyId) {
    setFlash(req, 'error', 'Perusahaan tidak ditemukan.');
    return res.redirect('/select-company');
  }

  const company = await getCompanyById(companyId);
  if (!company) {
    setFlash(req, 'error', 'Perusahaan tidak ditemukan.');
    return res.redirect('/select-company');
  }

  try {
    await deleteCompanyById(companyId);
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

router.get('/login', async (req, res) => {
  if (req.query.company) req.session.companyId = Number(req.query.company);
  if (!req.session.companyId) return res.redirect('/select-company');
  const company = await getCompanyById(req.session.companyId);
  if (!company) {
    req.session.companyId = null;
    return res.redirect('/select-company');
  }
  res.render('pages/login', { company });
});

router.post('/login', async (req, res) => {
  if (!req.session.companyId) return res.redirect('/select-company');
  const company = await getCompanyById(req.session.companyId);
  if (!company) return res.redirect('/select-company');

  const { email, password } = req.body;
  const rows = await query('SELECT * FROM users WHERE company_id = $1 AND email = $2', [
    company.id,
    email,
  ]);
  const user = rows[0];
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
