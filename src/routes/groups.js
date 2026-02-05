const express = require('express');
const { requireCompany, requireAuth } = require('../utils/auth');
const { divisionAccess, buildDivisionFilter } = require('../utils/division');
const { setFlash } = require('../utils/flash');

const router = express.Router();

router.get('/groups', requireCompany, requireAuth, divisionAccess, async (req, res) => {
  const filter = buildDivisionFilter(req.divisionIds, 'd.id', 2);
  const divisions = await req.db.query(
    'SELECT * FROM divisions WHERE company_id = $1 ORDER BY name ASC',
    [req.company.id]
  );
  const editId = req.query.edit ? Number(req.query.edit) : null;
  const groups = await req.db.query(
    `SELECT g.*, d.name AS division_name
     FROM item_groups g
     JOIN divisions d ON d.id = g.division_id
     WHERE g.company_id = $1 ${filter.clause}
     ORDER BY d.name ASC, g.name ASC`,
    [req.company.id, ...filter.params]
  );
  const allowedDivisions = req.divisionIds
    ? divisions.filter((div) => req.divisionIds.includes(div.id))
    : divisions;

  let editGroup = null;
  if (editId) {
    const rows = await req.db.query(
      `SELECT g.*, d.name AS division_name
       FROM item_groups g
       JOIN divisions d ON d.id = g.division_id
       WHERE g.id = $1 AND g.company_id = $2`,
      [editId, req.company.id]
    );
    const group = rows[0];
    if (group && (!req.divisionIds || req.divisionIds.includes(group.division_id))) {
      editGroup = group;
    }
  }

  res.render('pages/groups', { groups, divisions: allowedDivisions, editGroup });
});

router.post('/groups', requireCompany, requireAuth, divisionAccess, async (req, res) => {
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
    await req.db.query(
      'INSERT INTO item_groups (company_id, name, division_id, description) VALUES ($1, $2, $3, $4)',
      [req.company.id, name, division_id, description || null]
    );
    setFlash(req, 'success', 'Kelompok barang berhasil ditambahkan.');
  } catch (err) {
    setFlash(req, 'error', 'Kelompok barang gagal ditambahkan (nama mungkin sudah ada).');
  }
  res.redirect('/groups');
});

router.post('/groups/:id/update', requireCompany, requireAuth, divisionAccess, async (req, res) => {
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
    await req.db.query(
      'UPDATE item_groups SET name = $1, division_id = $2, description = $3 WHERE id = $4 AND company_id = $5',
      [name, division_id, description || null, id, req.company.id]
    );
    setFlash(req, 'success', 'Kelompok barang diperbarui.');
  } catch (err) {
    setFlash(req, 'error', 'Gagal memperbarui kelompok barang.');
  }
  res.redirect('/groups');
});

router.post('/groups/:id/delete', requireCompany, requireAuth, divisionAccess, async (req, res) => {
  const { id } = req.params;
  const groupRows = await req.db.query(
    `SELECT g.id, g.division_id
     FROM item_groups g
     WHERE g.id = $1 AND g.company_id = $2`,
    [id, req.company.id]
  );
  const groupRow = groupRows[0];
  if (!groupRow) {
    setFlash(req, 'error', 'Kelompok tidak ditemukan.');
    return res.redirect('/groups');
  }
  if (req.divisionIds && !req.divisionIds.includes(groupRow.division_id)) {
    setFlash(req, 'error', 'Tidak punya akses ke divisi tersebut.');
    return res.redirect('/groups');
  }

  const itemCountRows = await req.db.query(
    'SELECT COUNT(*) AS count FROM items WHERE group_id = $1 AND company_id = $2',
    [id, req.company.id]
  );
  const itemCount = Number(itemCountRows[0]?.count || 0);
  if (itemCount > 0) {
    const historyRows = await req.db.query(
      `SELECT
        (SELECT COUNT(*) FROM transactions t JOIN items i ON i.id = t.item_id WHERE i.group_id = $1 AND t.company_id = $2) +
        (SELECT COUNT(*) FROM adjustments a JOIN items i2 ON i2.id = a.item_id WHERE i2.group_id = $1 AND a.company_id = $2) +
        (SELECT COUNT(*) FROM opening_balances ob JOIN items i3 ON i3.id = ob.item_id WHERE i3.group_id = $1 AND ob.company_id = $2) AS count`,
      [id, req.company.id]
    );
    const historyCount = Number(historyRows[0]?.count || 0);
    if (historyCount > 0) {
      setFlash(req, 'error', 'Tidak bisa dihapus. Kelompok sudah punya stock/riwayat transaksi. Hubungi user utama.');
    } else {
      setFlash(req, 'error', 'Kelompok masih memiliki item. Hapus item terlebih dahulu.');
    }
    return res.redirect('/groups');
  }
  try {
    await req.db.query('DELETE FROM item_groups WHERE id = $1 AND company_id = $2', [
      id,
      req.company.id,
    ]);
    setFlash(req, 'success', 'Kelompok barang dihapus.');
  } catch (err) {
    setFlash(req, 'error', 'Kelompok barang tidak bisa dihapus karena masih dipakai.');
  }
  res.redirect('/groups');
});

module.exports = router;
