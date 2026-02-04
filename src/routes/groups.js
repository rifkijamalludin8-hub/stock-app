const express = require('express');
const { requireCompany, requireAuth } = require('../utils/auth');
const { divisionAccess, buildDivisionFilter } = require('../utils/division');
const { setFlash } = require('../utils/flash');

const router = express.Router();

router.get('/groups', requireCompany, requireAuth, divisionAccess, (req, res) => {
  const filter = buildDivisionFilter(req.divisionIds, 'd.id');
  const divisions = req.db.prepare('SELECT * FROM divisions ORDER BY name ASC').all();
  const editId = req.query.edit ? Number(req.query.edit) : null;
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

  let editGroup = null;
  if (editId) {
    const group = req.db
      .prepare(
        `SELECT g.*, d.name AS division_name
         FROM item_groups g
         JOIN divisions d ON d.id = g.division_id
         WHERE g.id = ?`
      )
      .get(editId);
    if (group && (!req.divisionIds || req.divisionIds.includes(group.division_id))) {
      editGroup = group;
    }
  }

  res.render('pages/groups', { groups, divisions: allowedDivisions, editGroup });
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
  if (!name || !division_id) {
    setFlash(req, 'error', 'Nama kelompok dan divisi wajib diisi.');
    return res.redirect('/groups');
  }
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
  const groupRow = req.db
    .prepare(
      `SELECT g.id, g.division_id
       FROM item_groups g
       WHERE g.id = ?`
    )
    .get(id);
  if (!groupRow) {
    setFlash(req, 'error', 'Kelompok tidak ditemukan.');
    return res.redirect('/groups');
  }
  if (req.divisionIds && !req.divisionIds.includes(groupRow.division_id)) {
    setFlash(req, 'error', 'Tidak punya akses ke divisi tersebut.');
    return res.redirect('/groups');
  }

  const itemCount = req.db
    .prepare('SELECT COUNT(*) AS count FROM items WHERE group_id = ?')
    .get(id).count;
  if (itemCount > 0) {
    const historyCount = req.db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM transactions t JOIN items i ON i.id = t.item_id WHERE i.group_id = ?) +
          (SELECT COUNT(*) FROM adjustments a JOIN items i2 ON i2.id = a.item_id WHERE i2.group_id = ?) +
          (SELECT COUNT(*) FROM opening_balances ob JOIN items i3 ON i3.id = ob.item_id WHERE i3.group_id = ?) AS count`
      )
      .get(id, id, id).count;
    if (historyCount > 0) {
      setFlash(req, 'error', 'Tidak bisa dihapus. Kelompok sudah punya stock/riwayat transaksi. Hubungi user utama.');
    } else {
      setFlash(req, 'error', 'Kelompok masih memiliki item. Hapus item terlebih dahulu.');
    }
    return res.redirect('/groups');
  }
  try {
    req.db.prepare('DELETE FROM item_groups WHERE id = ?').run(id);
    setFlash(req, 'success', 'Kelompok barang dihapus.');
  } catch (err) {
    setFlash(req, 'error', 'Kelompok barang tidak bisa dihapus karena masih dipakai.');
  }
  res.redirect('/groups');
});

module.exports = router;
