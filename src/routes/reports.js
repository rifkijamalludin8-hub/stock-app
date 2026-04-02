const express = require('express');
const dayjs = require('dayjs');
const { requireCompany, requireAuth, canSeePrice } = require('../utils/auth');
const { getReportRows, groupReportRows } = require('../utils/report');
const { divisionAccess } = require('../utils/division');

const router = express.Router();

router.get('/reports', requireCompany, requireAuth, divisionAccess, async (req, res) => {
  const start = req.query.start || '';
  const end = req.query.end || '';
  const divisionParam = req.query.division_id ? Number(req.query.division_id) : null;
  const allDivisions = await req.db.query(
    'SELECT id, name FROM divisions WHERE company_id = $1 ORDER BY name ASC',
    [req.company.id]
  );
  const visibleDivisions = req.divisionIds
    ? allDivisions.filter((div) => req.divisionIds.includes(div.id))
    : allDivisions;
  const divisionsList = visibleDivisions;
  const selectedDivision = divisionParam
    ? divisionsList.find((div) => Number(div.id) === divisionParam) || null
    : null;

  let divisionFilterIds = req.divisionIds;
  let selectedDivisionId = '';
  if (selectedDivision) {
    divisionFilterIds = [Number(selectedDivision.id)];
    selectedDivisionId = String(selectedDivision.id);
  }

  let divisions = [];
  let rows = [];
  if (start && end) {
    rows = await getReportRows(req.db, req.company.id, start, end, divisionFilterIds);
    divisions = groupReportRows(rows);
  }

  res.render('pages/reports', {
    start: start || dayjs().format('YYYY-MM-01'),
    end: end || dayjs().format('YYYY-MM-DD'),
    divisions,
    rows,
    showPrice: canSeePrice(req),
    divisionsList,
    selectedDivisionId,
    showDivisionFilter: divisionsList.length > 0,
  });
});

module.exports = router;
