const express = require('express');
const { requireCompany, requireAuth, requireRole } = require('../utils/auth');
const { setFlash } = require('../utils/flash');

const router = express.Router();

router.get('/divisions', requireCompany, requireAuth, requireRole('user'), (req, res) => {
  const divisions = req.db.prepare('SELECT * FROM divisions ORDER BY name ASC').all();
  res.render('pages/divisions', { divisions });
});

router.post('/divisions', requireCompany, requireAuth, requireRole('user'), (req, res) => {
  const { name, description } = req.body;
  if (!name) {
    setFlash(req, 'error', 'Nama divisi wajib diisi.');
    return res.redirect('/divisions');
  }
  try {
    req.db.prepare('INSERT INTO divisions (name, description) VALUES (?, ?)').run(name, description || null);
    setFlash(req, 'success', 'Divisi berhasil ditambahkan.');
  } catch (err) {
    setFlash(req, 'error', 'Divisi gagal ditambahkan (nama mungkin sudah ada).');
  }
  res.redirect('/divisions');
});

router.post('/divisions/:id/delete', requireCompany, requireAuth, requireRole('user'), (req, res) => {
  const { id } = req.params;
  try {
    req.db.prepare('DELETE FROM divisions WHERE id = ?').run(id);
    setFlash(req, 'success', 'Divisi dihapus.');
  } catch (err) {
    setFlash(req, 'error', 'Divisi tidak bisa dihapus karena masih dipakai.');
  }
  res.redirect('/divisions');
});

module.exports = router;
