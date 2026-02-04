const express = require('express');
const { requireCompany, requireAuth, requireRole } = require('../utils/auth');
const { setFlash } = require('../utils/flash');
const { hashPassword } = require('../utils/auth');

const router = express.Router();

router.get('/users', requireCompany, requireAuth, requireRole('user'), (req, res) => {
  const users = req.db
    .prepare('SELECT id, name, email, role, created_at FROM users ORDER BY name ASC')
    .all();
  const divisions = req.db.prepare('SELECT * FROM divisions ORDER BY name ASC').all();
  const userDivisions = req.db.prepare('SELECT user_id, division_id FROM user_divisions').all();
  const divisionMap = new Map();
  userDivisions.forEach((row) => {
    if (!divisionMap.has(row.user_id)) divisionMap.set(row.user_id, new Set());
    divisionMap.get(row.user_id).add(row.division_id);
  });
  res.render('pages/users', { users, divisions, divisionMap });
});

router.post('/users', requireCompany, requireAuth, requireRole('user'), async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    setFlash(req, 'error', 'Nama, email, dan password wajib diisi.');
    return res.redirect('/users');
  }
  try {
    const passwordHash = await hashPassword(password);
    req.db
      .prepare('INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(name, email, passwordHash, role || 'admin', new Date().toISOString());
    setFlash(req, 'success', 'User berhasil ditambahkan.');
  } catch (err) {
    setFlash(req, 'error', 'Gagal menambahkan user (email mungkin sudah terpakai).');
  }
  res.redirect('/users');
});

router.post('/users/:id/delete', requireCompany, requireAuth, requireRole('user'), (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.session.user.id) {
    setFlash(req, 'error', 'Tidak bisa menghapus akun sendiri.');
    return res.redirect('/users');
  }
  try {
    req.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    setFlash(req, 'success', 'User dihapus.');
  } catch (err) {
    setFlash(req, 'error', 'Gagal menghapus user.');
  }
  res.redirect('/users');
});

router.post('/users/:id/divisions', requireCompany, requireAuth, requireRole('user'), (req, res) => {
  const { id } = req.params;
  const user = req.db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
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
  const tx = req.db.transaction(() => {
    req.db.prepare('DELETE FROM user_divisions WHERE user_id = ?').run(id);
    divisionIds.forEach((divisionId) => {
      req.db
        .prepare('INSERT INTO user_divisions (user_id, division_id) VALUES (?, ?)')
        .run(id, Number(divisionId));
    });
  });
  try {
    tx();
    setFlash(req, 'success', 'Divisi admin diperbarui.');
  } catch (err) {
    setFlash(req, 'error', 'Gagal memperbarui divisi admin.');
  }
  res.redirect('/users');
});

module.exports = router;
