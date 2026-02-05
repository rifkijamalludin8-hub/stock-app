const express = require('express');
const { requireCompany, requireAuth } = require('../utils/auth');
const { setFlash } = require('../utils/flash');
const { getCurrentStockMap } = require('../utils/stock');
const { divisionAccess, buildDivisionFilter } = require('../utils/division');

const router = express.Router();

router.get('/items', requireCompany, requireAuth, divisionAccess, async (req, res) => {
  const db = req.db;
  const filter = buildDivisionFilter(req.divisionIds, 'd.id', 2);
  const editId = req.query.edit ? Number(req.query.edit) : null;
  const divisions = await db.query(
    'SELECT * FROM divisions WHERE company_id = $1 ORDER BY name ASC',
    [req.company.id]
  );
  const groups = await db.query(
    `SELECT g.*, d.name AS division_name
     FROM item_groups g
     JOIN divisions d ON d.id = g.division_id
     WHERE g.company_id = $1 ${filter.clause}
     ORDER BY d.name ASC, g.name ASC`,
    [req.company.id, ...filter.params]
  );
  const items = await db.query(
    `SELECT i.*, g.name AS group_name, g.id AS group_id, d.id AS division_id, d.name AS division_name
     FROM items i
     JOIN item_groups g ON g.id = i.group_id
     JOIN divisions d ON d.id = g.division_id
     WHERE i.company_id = $1 ${filter.clause}
     ORDER BY d.name ASC, g.name ASC, i.name ASC`,
    [req.company.id, ...filter.params]
  );

  const stockMap = await getCurrentStockMap(db, req.company.id, req.divisionIds);
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

  let editItem = null;
  if (editId) {
    const rows = await db.query(
      `SELECT i.*, g.id AS group_id, g.division_id
       FROM items i
       JOIN item_groups g ON g.id = i.group_id
       WHERE i.id = $1 AND i.company_id = $2`,
      [editId, req.company.id]
    );
    const item = rows[0];
    if (item && (!req.divisionIds || req.divisionIds.includes(item.division_id))) {
      editItem = item;
    }
  }

  res.render('pages/items', {
    divisions: divisionsData,
    groups,
    divisionsList: allowedDivisions,
    editItem,
  });
});

router.post('/items', requireCompany, requireAuth, divisionAccess, async (req, res) => {
  let { name, group_id, sku, unit, expiry_date, min_stock } = req.body;
  if (!name || !group_id) {
    setFlash(req, 'error', 'Nama item dan kelompok wajib diisi.');
    return res.redirect('/items');
  }
  if (req.divisionIds) {
    const rows = await req.db.query(
      'SELECT division_id FROM item_groups WHERE id = $1 AND company_id = $2',
      [group_id, req.company.id]
    );
    const group = rows[0];
    if (!group || !req.divisionIds.includes(group.division_id)) {
      setFlash(req, 'error', 'Tidak punya akses ke divisi tersebut.');
      return res.redirect('/items');
    }
  }
  try {
    if (!sku) {
      const skuRows = await req.db.query(
        "SELECT MAX(CAST(sku AS INTEGER)) AS maxSku FROM items WHERE company_id = $1 AND sku ~ '^[0-9]+$'",
        [req.company.id]
      );
      const nextSku = (skuRows[0]?.maxsku ? Number(skuRows[0].maxsku) : 0) + 1;
      sku = String(nextSku).padStart(4, '0');
    }
    await req.db.query(
      'INSERT INTO items (company_id, name, group_id, sku, unit, expiry_date, min_stock, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [
        req.company.id,
        name,
        group_id,
        sku || null,
        unit || null,
        expiry_date || null,
        min_stock || 0,
        new Date().toISOString(),
      ]
    );
    setFlash(req, 'success', 'Item berhasil ditambahkan.');
  } catch (err) {
    setFlash(req, 'error', 'Gagal menambahkan item.');
  }
  res.redirect('/items');
});

router.post('/items/:id/update', requireCompany, requireAuth, divisionAccess, async (req, res) => {
  const { id } = req.params;
  const { name, group_id, sku, unit, expiry_date, min_stock } = req.body;
  if (req.divisionIds) {
    const rows = await req.db.query(
      'SELECT division_id FROM item_groups WHERE id = $1 AND company_id = $2',
      [group_id, req.company.id]
    );
    const group = rows[0];
    if (!group || !req.divisionIds.includes(group.division_id)) {
      setFlash(req, 'error', 'Tidak punya akses ke divisi tersebut.');
      return res.redirect('/items');
    }
  }
  try {
    await req.db.query(
      'UPDATE items SET name = $1, group_id = $2, sku = $3, unit = $4, expiry_date = $5, min_stock = $6 WHERE id = $7 AND company_id = $8',
      [name, group_id, sku || null, unit || null, expiry_date || null, min_stock || 0, id, req.company.id]
    );
    setFlash(req, 'success', 'Item diperbarui.');
  } catch (err) {
    setFlash(req, 'error', 'Gagal memperbarui item.');
  }
  res.redirect('/items');
});

router.post('/items/:id/delete', requireCompany, requireAuth, divisionAccess, async (req, res) => {
  const { id } = req.params;
  const numericId = Number(id);
  if (req.divisionIds) {
    const rows = await req.db.query(
      `SELECT g.division_id
       FROM items i
       JOIN item_groups g ON g.id = i.group_id
       WHERE i.id = $1 AND i.company_id = $2`,
      [numericId, req.company.id]
    );
    const item = rows[0];
    if (!item || !req.divisionIds.includes(item.division_id)) {
      setFlash(req, 'error', 'Tidak punya akses ke divisi tersebut.');
      return res.redirect('/items');
    }
  }
  const stockMap = await getCurrentStockMap(req.db, req.company.id, req.divisionIds);
  const currentStock = stockMap.get(numericId) || 0;
  if (currentStock !== 0) {
    setFlash(req, 'error', 'Item tidak bisa dihapus karena masih ada stock. Hubungi user utama.');
    return res.redirect('/items');
  }
  const historyRows = await req.db.query(
    `SELECT
      (SELECT COUNT(*) FROM transactions WHERE item_id = $1 AND company_id = $2) +
      (SELECT COUNT(*) FROM adjustments WHERE item_id = $1 AND company_id = $2) +
      (SELECT COUNT(*) FROM opening_balances WHERE item_id = $1 AND company_id = $2) AS count`,
    [numericId, req.company.id]
  );
  const historyCount = Number(historyRows[0]?.count || 0);
  if (historyCount > 0) {
    setFlash(req, 'error', 'Item tidak bisa dihapus karena sudah ada riwayat transaksi. Hubungi user utama.');
    return res.redirect('/items');
  }
  try {
    await req.db.query('DELETE FROM items WHERE id = $1 AND company_id = $2', [
      numericId,
      req.company.id,
    ]);
    setFlash(req, 'success', 'Item dihapus.');
  } catch (err) {
    setFlash(req, 'error', 'Item tidak bisa dihapus karena ada transaksi.');
  }
  res.redirect('/items');
});

module.exports = router;
