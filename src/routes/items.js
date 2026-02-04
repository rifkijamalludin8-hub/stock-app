const express = require('express');
const { requireCompany, requireAuth } = require('../utils/auth');
const { setFlash } = require('../utils/flash');
const { getCurrentStockMap } = require('../utils/stock');
const { divisionAccess, buildDivisionFilter } = require('../utils/division');

const router = express.Router();

router.get('/items', requireCompany, requireAuth, divisionAccess, (req, res) => {
  const db = req.db;
  const filter = buildDivisionFilter(req.divisionIds, 'd.id');
  const divisions = db.prepare('SELECT * FROM divisions ORDER BY name ASC').all();
  const groups = db
    .prepare(
      `SELECT g.*, d.name AS division_name
       FROM item_groups g
       JOIN divisions d ON d.id = g.division_id
       WHERE 1=1 ${filter.clause}
       ORDER BY d.name ASC, g.name ASC`
    )
    .all(...filter.params);
  const items = db
    .prepare(
      `SELECT i.*, g.name AS group_name, g.id AS group_id, d.id AS division_id, d.name AS division_name
       FROM items i
       JOIN item_groups g ON g.id = i.group_id
       JOIN divisions d ON d.id = g.division_id
       WHERE 1=1 ${filter.clause}
       ORDER BY d.name ASC, g.name ASC, i.name ASC`
    )
    .all(...filter.params);

  const stockMap = getCurrentStockMap(db, req.divisionIds);
  const itemsWithStock = items.map((item) => ({
    ...item,
    stock: stockMap.get(item.id) || 0,
  }));

  const allowedDivisions = req.divisionIds
    ? divisions.filter((div) => req.divisionIds.includes(div.id))
    : divisions;

  const divisionMap = new Map();
  itemsWithStock.forEach((item) => {
    if (!divisionMap.has(item.division_id)) {
      divisionMap.set(item.division_id, {
        id: item.division_id,
        name: item.division_name,
        groups: [],
        groupMap: new Map(),
      });
    }
    const division = divisionMap.get(item.division_id);
    if (!division.groupMap.has(item.group_id)) {
      const group = { id: item.group_id, name: item.group_name, items: [] };
      division.groupMap.set(item.group_id, group);
      division.groups.push(group);
    }
    division.groupMap.get(item.group_id).items.push(item);
  });

  const divisionsData = Array.from(divisionMap.values()).map((div) => {
    const clean = { id: div.id, name: div.name, groups: div.groups };
    return clean;
  });

  res.render('pages/items', { divisions: divisionsData, groups, divisionsList: allowedDivisions });
});

router.post('/items', requireCompany, requireAuth, divisionAccess, (req, res) => {
  const { name, group_id, sku, unit, expiry_date, min_stock } = req.body;
  if (!name || !group_id) {
    setFlash(req, 'error', 'Nama item dan kelompok wajib diisi.');
    return res.redirect('/items');
  }
  if (req.divisionIds) {
    const group = req.db.prepare('SELECT division_id FROM item_groups WHERE id = ?').get(group_id);
    if (!group || !req.divisionIds.includes(group.division_id)) {
      setFlash(req, 'error', 'Tidak punya akses ke divisi tersebut.');
      return res.redirect('/items');
    }
  }
  try {
    req.db
      .prepare(
        'INSERT INTO items (name, group_id, sku, unit, expiry_date, min_stock, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        name,
        group_id,
        sku || null,
        unit || null,
        expiry_date || null,
        min_stock || 0,
        new Date().toISOString()
      );
    setFlash(req, 'success', 'Item berhasil ditambahkan.');
  } catch (err) {
    setFlash(req, 'error', 'Gagal menambahkan item.');
  }
  res.redirect('/items');
});

router.post('/items/:id/update', requireCompany, requireAuth, divisionAccess, (req, res) => {
  const { id } = req.params;
  const { name, group_id, sku, unit, expiry_date, min_stock } = req.body;
  if (req.divisionIds) {
    const group = req.db.prepare('SELECT division_id FROM item_groups WHERE id = ?').get(group_id);
    if (!group || !req.divisionIds.includes(group.division_id)) {
      setFlash(req, 'error', 'Tidak punya akses ke divisi tersebut.');
      return res.redirect('/items');
    }
  }
  try {
    req.db
      .prepare(
        'UPDATE items SET name = ?, group_id = ?, sku = ?, unit = ?, expiry_date = ?, min_stock = ? WHERE id = ?'
      )
      .run(name, group_id, sku || null, unit || null, expiry_date || null, min_stock || 0, id);
    setFlash(req, 'success', 'Item diperbarui.');
  } catch (err) {
    setFlash(req, 'error', 'Gagal memperbarui item.');
  }
  res.redirect('/items');
});

router.post('/items/:id/delete', requireCompany, requireAuth, divisionAccess, (req, res) => {
  const { id } = req.params;
  if (req.divisionIds) {
    const item = req.db
      .prepare(
        `SELECT g.division_id
         FROM items i
         JOIN item_groups g ON g.id = i.group_id
         WHERE i.id = ?`
      )
      .get(id);
    if (!item || !req.divisionIds.includes(item.division_id)) {
      setFlash(req, 'error', 'Tidak punya akses ke divisi tersebut.');
      return res.redirect('/items');
    }
  }
  try {
    req.db.prepare('DELETE FROM items WHERE id = ?').run(id);
    setFlash(req, 'success', 'Item dihapus.');
  } catch (err) {
    setFlash(req, 'error', 'Item tidak bisa dihapus karena ada transaksi.');
  }
  res.redirect('/items');
});

module.exports = router;
