async function getDivisionAccess(req) {
  if (!req.session.user) return { divisionIds: null, warning: null };
  if (req.session.user.role === 'user') {
    return { divisionIds: null, warning: null };
  }
  const rows = await req.db.query(
    'SELECT division_id FROM user_divisions WHERE user_id = $1',
    [req.session.user.id]
  );
  const divisionIds = rows.map((row) => Number(row.division_id));
  const warning = divisionIds.length === 0 ? 'Admin belum memiliki divisi. Hubungi user utama.' : null;
  return { divisionIds, warning };
}

function buildDivisionFilter(divisionIds, column, startIndex = 1) {
  if (!divisionIds) return { clause: '', params: [], nextIndex: startIndex };
  if (divisionIds.length === 0) return { clause: ' AND 1=0', params: [], nextIndex: startIndex };
  return { clause: ` AND ${column} = ANY($${startIndex})`, params: [divisionIds], nextIndex: startIndex + 1 };
}

async function divisionAccess(req, res, next) {
  const { divisionIds, warning } = await getDivisionAccess(req);
  req.divisionIds = divisionIds;
  res.locals.divisionWarning = warning;
  next();
}

module.exports = { getDivisionAccess, buildDivisionFilter, divisionAccess };
