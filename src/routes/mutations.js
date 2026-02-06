const express = require('express');
const dayjs = require('dayjs');
const { requireCompany, requireAuth } = require('../utils/auth');
const { divisionAccess, buildDivisionFilter } = require('../utils/division');
const { getMutationRows } = require('../utils/mutations');

const router = express.Router();

router.get('/mutations', requireCompany, requireAuth, divisionAccess, async (req, res) => {
  const db = req.db;
  const companyId = req.company.id;
  const filter = buildDivisionFilter(req.divisionIds, 'd.id', 2);
  const items = await db.query(
    `SELECT i.id, i.name, i.expiry_date, g.name AS group_name
     FROM items i
     JOIN item_groups g ON g.id = i.group_id
     JOIN divisions d ON d.id = g.division_id
     WHERE i.company_id = $1 ${filter.clause}
     ORDER BY g.name ASC, i.name ASC`,
    [companyId, ...filter.params]
  );

  const start = req.query.start || dayjs().format('YYYY-MM-01');
  const end = req.query.end || dayjs().format('YYYY-MM-DD');
  const itemId = req.query.item_id ? Number(req.query.item_id) : null;

  let grouped = [];
  let flatRows = [];
  if (start && end) {
    const result = await getMutationRows(db, companyId, start, end, req.divisionIds, itemId);
    grouped = result.grouped;
    flatRows = result.flatRows;
  }

  res.render('pages/mutations', {
    items,
    grouped,
    flatRows,
    start,
    end,
    itemId,
  });
});

module.exports = router;
