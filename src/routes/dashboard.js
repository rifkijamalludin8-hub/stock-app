const express = require('express');
const dayjs = require('dayjs');
const { requireCompany, requireAuth, canSeePrice } = require('../utils/auth');
const { getCurrentStockRows } = require('../utils/stock');
const { divisionAccess, buildDivisionFilter } = require('../utils/division');

const router = express.Router();

router.get('/', requireCompany, requireAuth, divisionAccess, (req, res) => {
  const db = req.db;
  const today = dayjs().format('YYYY-MM-DD');
  const divisionIds = req.divisionIds;
  const filter = buildDivisionFilter(divisionIds, 'd.id');

  const totalItems = db
    .prepare(
      `SELECT COUNT(*) as count
       FROM items i
       JOIN item_groups g ON g.id = i.group_id
       JOIN divisions d ON d.id = g.division_id
       WHERE 1=1 ${filter.clause}`
    )
    .get(...filter.params).count;
  const totalGroups = db
    .prepare(
      `SELECT COUNT(*) as count
       FROM item_groups g
       JOIN divisions d ON d.id = g.division_id
       WHERE 1=1 ${filter.clause}`
    )
    .get(...filter.params).count;
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;

  const stockRows = getCurrentStockRows(db, divisionIds);
  const totalStock = stockRows.reduce((acc, row) => acc + (row.stock || 0), 0);
  const lowStock = stockRows.filter((row) => row.stock <= row.min_stock).slice(0, 6);

  const inToday = db
    .prepare(
      `SELECT COALESCE(SUM(t.qty),0) as qty
       FROM transactions t
       JOIN items i ON i.id = t.item_id
       JOIN item_groups g ON g.id = i.group_id
       JOIN divisions d ON d.id = g.division_id
       WHERE t.type='IN' AND t.txn_date = ? ${filter.clause}`
    )
    .get(today, ...filter.params).qty;
  const outToday = db
    .prepare(
      `SELECT COALESCE(SUM(t.qty),0) as qty
       FROM transactions t
       JOIN items i ON i.id = t.item_id
       JOIN item_groups g ON g.id = i.group_id
       JOIN divisions d ON d.id = g.division_id
       WHERE t.type='OUT' AND t.txn_date = ? ${filter.clause}`
    )
    .get(today, ...filter.params).qty;

  const recentTransactions = db
    .prepare(
      `SELECT t.id, t.type, t.qty, t.price_per_unit, t.txn_date, i.name AS item_name
       FROM transactions t
       JOIN items i ON i.id = t.item_id
       JOIN item_groups g ON g.id = i.group_id
       JOIN divisions d ON d.id = g.division_id
       WHERE 1=1 ${filter.clause}
       ORDER BY t.txn_date DESC, t.id DESC
       LIMIT 8`
    )
    .all(...filter.params);

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
