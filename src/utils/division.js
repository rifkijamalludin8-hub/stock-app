function getDivisionAccess(req) {
  if (!req.session.user) return { divisionIds: null, warning: null };
  if (req.session.user.role === 'user') {
    return { divisionIds: null, warning: null };
  }
  const rows = req.db
    .prepare('SELECT division_id FROM user_divisions WHERE user_id = ?')
    .all(req.session.user.id);
  const divisionIds = rows.map((row) => row.division_id);
  const warning = divisionIds.length === 0 ? 'Admin belum memiliki divisi. Hubungi user utama.' : null;
  return { divisionIds, warning };
}

function buildDivisionFilter(divisionIds, column) {
  if (!divisionIds) return { clause: '', params: [] };
  if (divisionIds.length === 0) return { clause: ' AND 1=0', params: [] };
  const placeholders = divisionIds.map(() => '?').join(',');
  return { clause: ` AND ${column} IN (${placeholders})`, params: divisionIds };
}

function divisionAccess(req, res, next) {
  const { divisionIds, warning } = getDivisionAccess(req);
  req.divisionIds = divisionIds;
  res.locals.divisionWarning = warning;
  next();
}

module.exports = { getDivisionAccess, buildDivisionFilter, divisionAccess };
