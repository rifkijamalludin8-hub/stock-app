const express = require('express');
const dayjs = require('dayjs');
const { requireCompany, requireAuth, canSeePrice } = require('../utils/auth');
const { getReportRows, groupReportRows } = require('../utils/report');
const { divisionAccess } = require('../utils/division');

const router = express.Router();

router.get('/reports', requireCompany, requireAuth, divisionAccess, (req, res) => {
  const start = req.query.start || '';
  const end = req.query.end || '';

  let divisions = [];
  let rows = [];
  if (start && end) {
    rows = getReportRows(req.db, start, end, req.divisionIds);
    divisions = groupReportRows(rows);
  }

  res.render('pages/reports', {
    start: start || dayjs().format('YYYY-MM-01'),
    end: end || dayjs().format('YYYY-MM-DD'),
    divisions,
    rows,
    showPrice: canSeePrice(req),
  });
});

module.exports = router;
