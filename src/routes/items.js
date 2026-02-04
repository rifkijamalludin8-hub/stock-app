const express = require('express');
const { requireCompany, requireAuth } = require('../utils/auth');
const { setFlash } = require('../utils/flash');
const { getCurrentStockMap } = require('../utils/stock');

const router = express.Router();

router.get('/items', requireCompany, requireAuth, (req, res) => {
  const db = req.db;
  const groups = db.prepare('SELECT * FROM item_groups ORDER BY name ASC').all();
  const items = db
    .prepare(
      `SELECT i.*, g.name AS group_name
       FROM items i
       JOIN item_groups g ON g.id = i.group_id
       ORDER BY g.name ASC, i.name ASC`
    )
    .all();

  const stockMap = getCurrentStockMap(db);
  const itemsWithStock = items.map((item) => ({
    ...item,
    stock: stockMap.get(item.id) || 0,
  }));

  res.render('pages/items', { items: itemsWithStock, groups });
});

router.post('/items', requireCompany, requireAuth, (req, res) => {
  const { name, group_id, sku, unit, expiry_date, min_stock } = req.body;
  if (!name || !group_id) {
    setFlash(req, 'error', 'Nama item dan kelompok wajib diisi.');
    return res.redirect('/items');
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

router.post('/items/:id/update', requireCompany, requireAuth, (req, res) => {
  const { id } = req.params;
  const { name, group_id, sku, unit, expiry_date, min_stock } = req.body;
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

router.post('/items/:id/delete', requireCompany, requireAuth, (req, res) => {
  const { id } = req.params;
  try {
    req.db.prepare('DELETE FROM items WHERE id = ?').run(id);
    setFlash(req, 'success', 'Item dihapus.');
  } catch (err) {
    setFlash(req, 'error', 'Item tidak bisa dihapus karena ada transaksi.');
  }
  res.redirect('/items');
});

module.exports = router;
