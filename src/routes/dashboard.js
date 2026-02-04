const express = require('express');
const dayjs = require('dayjs');
const { requireCompany, requireAuth, canSeePrice } = require('../utils/auth');
const { getCurrentStockRows } = require('../utils/stock');

const router = express.Router();

router.get('/', requireCompany, requireAuth, (req, res) => {
  const db = req.db;
  const today = dayjs().format('YYYY-MM-DD');

  const totalItems = db.prepare('SELECT COUNT(*) as count FROM items').get().count;
  const totalGroups = db.prepare('SELECT COUNT(*) as count FROM item_groups').get().count;
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;

  const stockRows = getCurrentStockRows(db);
  const totalStock = stockRows.reduce((acc, row) => acc + (row.stock || 0), 0);
  const lowStock = stockRows.filter((row) => row.stock <= row.min_stock).slice(0, 6);

  const inToday = db
    .prepare("SELECT COALESCE(SUM(qty),0) as qty FROM transactions WHERE type='IN' AND txn_date = ?")
    .get(today).qty;
  const outToday = db
    .prepare("SELECT COALESCE(SUM(qty),0) as qty FROM transactions WHERE type='OUT' AND txn_date = ?")
    .get(today).qty;

  const recentTransactions = db
    .prepare(
      `SELECT t.id, t.type, t.qty, t.price_per_unit, t.txn_date, i.name AS item_name
       FROM transactions t
       JOIN items i ON i.id = t.item_id
       ORDER BY t.txn_date DESC, t.id DESC
       LIMIT 8`
    )
    .all();

  res.render('pages/dashboard', {
    metrics: {
      totalItems,
      totalGroups,
      totalUsers,
      totalStock,
      inToday,
      outToday,
    },
    lowStock,
    recentTransactions,
    showPrice: canSeePrice(req),
  });
});

module.exports = router;
