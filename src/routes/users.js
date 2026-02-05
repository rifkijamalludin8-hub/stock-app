const express = require('express');
const { requireCompany, requireAuth, requireRole } = require('../utils/auth');
const { setFlash } = require('../utils/flash');
const { hashPassword } = require('../utils/auth');

const router = express.Router();

router.get('/users', requireCompany, requireAuth, requireRole('user'), async (req, res) => {
  const db = req.db;
  const companyId = req.company.id;
  const users = await db.query(
    'SELECT id, name, email, role, created_at FROM users WHERE company_id = $1 ORDER BY name ASC',
    [companyId]
  );
  const divisions = await db.query('SELECT * FROM divisions WHERE company_id = $1 ORDER BY name ASC', [companyId]);
  const userDivisions = await db.query(
    `SELECT ud.user_id, ud.division_id
     FROM user_divisions ud
     JOIN divisions d ON d.id = ud.division_id
     WHERE d.company_id = $1`,
    [companyId]
  );
  const divisionMap = new Map();
  userDivisions.forEach((row) => {
    if (!divisionMap.has(row.user_id)) divisionMap.set(row.user_id, new Set());
    divisionMap.get(row.user_id).add(row.division_id);
  });
  res.render('pages/users', { users, divisions, divisionMap });
});

router.post('/users', requireCompany, requireAuth, requireRole('user'), async (req, res) => {
  const db = req.db;
  const companyId = req.company.id;
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    setFlash(req, 'error', 'Nama, email, dan password wajib diisi.');
    return res.redirect('/users');
  }
  try {
    const passwordHash = await hashPassword(password);
    await db.query(
      `INSERT INTO users (company_id, name, email, password_hash, role, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [companyId, name, email, passwordHash, role || 'admin', new Date().toISOString()]
    );
    setFlash(req, 'success', 'User berhasil ditambahkan.');
  } catch (err) {
    setFlash(req, 'error', 'Gagal menambahkan user (email mungkin sudah terpakai).');
  }
  res.redirect('/users');
});

router.post('/users/:id/delete', requireCompany, requireAuth, requireRole('user'), async (req, res) => {
  const db = req.db;
  const companyId = req.company.id;
  const { id } = req.params;
  if (Number(id) === req.session.user.id) {
    setFlash(req, 'error', 'Tidak bisa menghapus akun sendiri.');
    return res.redirect('/users');
  }
  try {
    await db.query('DELETE FROM users WHERE id = $1 AND company_id = $2', [id, companyId]);
    setFlash(req, 'success', 'User dihapus.');
  } catch (err) {
    setFlash(req, 'error', 'Gagal menghapus user.');
  }
  res.redirect('/users');
});

router.post('/users/:id/divisions', requireCompany, requireAuth, requireRole('user'), async (req, res) => {
  const db = req.db;
  const companyId = req.company.id;
  const { id } = req.params;
  const userRows = await db.query('SELECT id, role FROM users WHERE id = $1 AND company_id = $2', [id, companyId]);
  const user = userRows[0];
  if (!user) {
    setFlash(req, 'error', 'User tidak ditemukan.');
    return res.redirect('/users');
  }
  if (user.role !== 'admin') {
    setFlash(req, 'error', 'Hanya admin yang perlu pengaturan divisi.');
    return res.redirect('/users');
  }
  const raw = req.body.division_ids;
  const divisionIds = Array.isArray(raw) ? raw : raw ? [raw] : [];
  try {
    await db.query('DELETE FROM user_divisions WHERE user_id = $1', [id]);
    if (divisionIds.length) {
      const allowed = await db.query('SELECT id FROM divisions WHERE company_id = $1', [companyId]);
      const allowedSet = new Set(allowed.map((row) => Number(row.id)));
      const values = [];
      const params = [];
      let idx = 1;
      divisionIds.forEach((divisionId) => {
        const parsed = Number(divisionId);
        if (!allowedSet.has(parsed)) return;
        values.push(`($${idx++}, $${idx++})`);
        params.push(Number(id), parsed);
      });
      if (values.length) {
        await db.query(`INSERT INTO user_divisions (user_id, division_id) VALUES ${values.join(', ')}`, params);
      }
    }
    setFlash(req, 'success', 'Divisi admin diperbarui.');
  } catch (err) {
    setFlash(req, 'error', 'Gagal memperbarui divisi admin.');
  }
  res.redirect('/users');
});

module.exports = router;
