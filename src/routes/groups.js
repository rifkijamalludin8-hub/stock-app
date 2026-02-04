const express = require('express');
const { requireCompany, requireAuth } = require('../utils/auth');
const { divisionAccess, buildDivisionFilter } = require('../utils/division');
const { setFlash } = require('../utils/flash');

const router = express.Router();

router.get('/groups', requireCompany, requireAuth, divisionAccess, (req, res) => {
  const filter = buildDivisionFilter(req.divisionIds, 'd.id');
  const divisions = req.db.prepare('SELECT * FROM divisions ORDER BY name ASC').all();
  const groups = req.db
    .prepare(
      `SELECT g.*, d.name AS division_name
       FROM item_groups g
       JOIN divisions d ON d.id = g.division_id
       WHERE 1=1 ${filter.clause}
       ORDER BY d.name ASC, g.name ASC`
    )
    .all(...filter.params);
  const allowedDivisions = req.divisionIds
    ? divisions.filter((div) => req.divisionIds.includes(div.id))
    : divisions;
  res.render('pages/groups', { groups, divisions: allowedDivisions });
});

router.post('/groups', requireCompany, requireAuth, divisionAccess, (req, res) => {
  const { name, description, division_id } = req.body;
  if (!name) {
    setFlash(req, 'error', 'Nama kelompok wajib diisi.');
    return res.redirect('/groups');
  }
  if (!division_id) {
    setFlash(req, 'error', 'Divisi wajib dipilih.');
    return res.redirect('/groups');
  }
  if (req.divisionIds && !req.divisionIds.includes(Number(division_id))) {
    setFlash(req, 'error', 'Tidak punya akses ke divisi tersebut.');
    return res.redirect('/groups');
  }
  try {
    req.db
      .prepare('INSERT INTO item_groups (name, division_id, description) VALUES (?, ?, ?)')
      .run(name, division_id, description || null);
    setFlash(req, 'success', 'Kelompok barang berhasil ditambahkan.');
  } catch (err) {
    setFlash(req, 'error', 'Kelompok barang gagal ditambahkan (nama mungkin sudah ada).');
  }
  res.redirect('/groups');
});

router.post('/groups/:id/update', requireCompany, requireAuth, divisionAccess, (req, res) => {
  const { id } = req.params;
  const { name, description, division_id } = req.body;
  if (req.divisionIds && !req.divisionIds.includes(Number(division_id))) {
    setFlash(req, 'error', 'Tidak punya akses ke divisi tersebut.');
    return res.redirect('/groups');
  }
  try {
    req.db
      .prepare('UPDATE item_groups SET name = ?, division_id = ?, description = ? WHERE id = ?')
      .run(name, division_id, description || null, id);
    setFlash(req, 'success', 'Kelompok barang diperbarui.');
  } catch (err) {
    setFlash(req, 'error', 'Gagal memperbarui kelompok barang.');
  }
  res.redirect('/groups');
});

router.post('/groups/:id/delete', requireCompany, requireAuth, divisionAccess, (req, res) => {
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
