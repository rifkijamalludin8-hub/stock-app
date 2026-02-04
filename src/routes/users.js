const express = require('express');
const { requireCompany, requireAuth, requireRole } = require('../utils/auth');
const { setFlash } = require('../utils/flash');
const { hashPassword } = require('../utils/auth');

const router = express.Router();

router.get('/users', requireCompany, requireAuth, requireRole('user'), (req, res) => {
  const users = req.db.prepare('SELECT id, name, email, role, created_at FROM users ORDER BY name ASC').all();
  res.render('pages/users', { users });
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

module.exports = router;
