const express = require('express');
const dayjs = require('dayjs');
const { requireCompany, requireAuth, canSeePrice } = require('../utils/auth');
const { getCurrentStockRows } = require('../utils/stock');
const { divisionAccess, buildDivisionFilter } = require('../utils/division');

const router = express.Router();

router.get('/', requireCompany, requireAuth, divisionAccess, async (req, res) => {
  const db = req.db;
  const companyId = req.company.id;
  const today = dayjs().format('YYYY-MM-DD');
  const divisionIds = req.divisionIds;
  const filter = buildDivisionFilter(divisionIds, 'd.id', 2);

  const totalItems = (
    await db.query(
      `SELECT COUNT(*) as count
       FROM items i
       JOIN item_groups g ON g.id = i.group_id
       JOIN divisions d ON d.id = g.division_id
       WHERE i.company_id = $1 ${filter.clause}`,
      [companyId, ...filter.params]
    )
  )[0]?.count;
  const totalGroups = (
    await db.query(
      `SELECT COUNT(*) as count
       FROM item_groups g
       JOIN divisions d ON d.id = g.division_id
       WHERE g.company_id = $1 ${filter.clause}`,
      [companyId, ...filter.params]
    )
  )[0]?.count;
  const totalUsers = (
    await db.query('SELECT COUNT(*) as count FROM users WHERE company_id = $1', [companyId])
  )[0]?.count;

  const stockRows = await getCurrentStockRows(db, companyId, divisionIds);
  const totalStock = stockRows.reduce((acc, row) => acc + Number(row.stock || 0), 0);
  const lowStock = stockRows
    .filter((row) => Number(row.stock || 0) <= Number(row.min_stock || 0))
    .slice(0, 6);

  const filterTxn = buildDivisionFilter(divisionIds, 'd.id', 3);
  const inToday = (
    await db.query(
      `SELECT COALESCE(SUM(t.qty),0) as qty
       FROM transactions t
       JOIN items i ON i.id = t.item_id
       JOIN item_groups g ON g.id = i.group_id
       JOIN divisions d ON d.id = g.division_id
       WHERE t.company_id = $1 AND t.type='IN' AND t.txn_date = $2 ${filterTxn.clause}`,
      [companyId, today, ...filterTxn.params]
    )
  )[0]?.qty;
  const outToday = (
    await db.query(
      `SELECT COALESCE(SUM(t.qty),0) as qty
       FROM transactions t
       JOIN items i ON i.id = t.item_id
       JOIN item_groups g ON g.id = i.group_id
       JOIN divisions d ON d.id = g.division_id
       WHERE t.company_id = $1 AND t.type='OUT' AND t.txn_date = $2 ${filterTxn.clause}`,
      [companyId, today, ...filterTxn.params]
    )
  )[0]?.qty;

  const recentTransactions = await db.query(
    `SELECT t.id, t.type, t.qty, t.price_per_unit, t.txn_date, i.name AS item_name
     FROM transactions t
     JOIN items i ON i.id = t.item_id
     JOIN item_groups g ON g.id = i.group_id
     JOIN divisions d ON d.id = g.division_id
     WHERE t.company_id = $1 ${filter.clause}
     ORDER BY t.txn_date DESC, t.id DESC
     LIMIT 8`,
    [companyId, ...filter.params]
  );

  res.render('pages/dashboard', {
    metrics: {
      totalItems: Number(totalItems || 0),
      totalGroups: Number(totalGroups || 0),
      totalUsers: Number(totalUsers || 0),
      totalStock,
      inToday: Number(inToday || 0),
      outToday: Number(outToday || 0),
    },
    lowStock,
    recentTransactions,
    showPrice: canSeePrice(req),
  });
});

module.exports = router;
