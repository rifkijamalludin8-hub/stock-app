const { buildDivisionFilter } = require('./division');

async function getCurrentStockRows(db, companyId, divisionIds = null) {
  const filter = buildDivisionFilter(divisionIds, 'd.id', 2);
  const sql = `
    SELECT items.id,
      items.name,
      items.unit,
      items.min_stock,
      items.expiry_date,
      g.name AS group_name,
      d.name AS division_name,
      COALESCE(SUM(CASE WHEN t.type = 'IN' THEN t.qty ELSE -t.qty END), 0)
        + COALESCE((SELECT SUM(qty_delta) FROM adjustments a WHERE a.item_id = items.id AND a.company_id = $1), 0)
        + COALESCE((SELECT SUM(qty) FROM opening_balances ob WHERE ob.item_id = items.id AND ob.company_id = $1), 0)
        AS stock
    FROM items
    JOIN item_groups g ON g.id = items.group_id
    JOIN divisions d ON d.id = g.division_id
    LEFT JOIN transactions t ON t.item_id = items.id AND t.company_id = $1
    WHERE items.company_id = $1 ${filter.clause}
    GROUP BY items.id, g.name, d.name
    ORDER BY d.name ASC, g.name ASC, items.name ASC
  `;
  return db.query(sql, [companyId, ...filter.params]);
}

async function getCurrentStockMap(db, companyId, divisionIds = null) {
  const rows = await getCurrentStockRows(db, companyId, divisionIds);
  const map = new Map();
  rows.forEach((row) => map.set(row.id, Number(row.stock || 0)));
  return map;
}

module.exports = { getCurrentStockRows, getCurrentStockMap };
