const express = require('express');
const { requireCompany, requireAuth } = require('../utils/auth');
const { setFlash } = require('../utils/flash');

const router = express.Router();

router.get('/groups', requireCompany, requireAuth, (req, res) => {
  const groups = req.db.prepare('SELECT * FROM item_groups ORDER BY name ASC').all();
  res.render('pages/groups', { groups });
});

router.post('/groups', requireCompany, requireAuth, (req, res) => {
  const { name, description } = req.body;
  if (!name) {
    setFlash(req, 'error', 'Nama kelompok wajib diisi.');
    return res.redirect('/groups');
  }
  try {
    req.db
      .prepare('INSERT INTO item_groups (name, description) VALUES (?, ?)')
      .run(name, description || null);
    setFlash(req, 'success', 'Kelompok barang berhasil ditambahkan.');
  } catch (err) {
    setFlash(req, 'error', 'Kelompok barang gagal ditambahkan (nama mungkin sudah ada).');
  }
  res.redirect('/groups');
});

router.post('/groups/:id/update', requireCompany, requireAuth, (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;
  try {
    req.db
      .prepare('UPDATE item_groups SET name = ?, description = ? WHERE id = ?')
      .run(name, description || null, id);
    setFlash(req, 'success', 'Kelompok barang diperbarui.');
  } catch (err) {
    setFlash(req, 'error', 'Gagal memperbarui kelompok barang.');
  }
  res.redirect('/groups');
});

router.post('/groups/:id/delete', requireCompany, requireAuth, (req, res) => {
  const { id } = req.params;
  try {
    req.db.prepare('DELETE FROM item_groups WHERE id = ?').run(id);
    setFlash(req, 'success', 'Kelompok barang dihapus.');
  } catch (err) {
    setFlash(req, 'error', 'Kelompok barang tidak bisa dihapus karena masih dipakai.');
  }
  res.redirect('/groups');
});

module.exports = router;
