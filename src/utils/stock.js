const { buildDivisionFilter } = require('./division');

function getCurrentStockRows(db, divisionIds = null) {
  const filter = buildDivisionFilter(divisionIds, 'd.id');
  const sql = `
    SELECT items.id,
      items.name,
      items.unit,
      items.min_stock,
      items.expiry_date,
      g.name AS group_name,
      d.name AS division_name,
      COALESCE(SUM(CASE WHEN t.type = 'IN' THEN t.qty ELSE -t.qty END), 0)
        + COALESCE((SELECT SUM(qty_delta) FROM adjustments a WHERE a.item_id = items.id), 0)
        AS stock
    FROM items
    JOIN item_groups g ON g.id = items.group_id
    JOIN divisions d ON d.id = g.division_id
    LEFT JOIN transactions t ON t.item_id = items.id
    WHERE 1=1 ${filter.clause}
    GROUP BY items.id
    ORDER BY d.name ASC, g.name ASC, items.name ASC
  `;
  return db.prepare(sql).all(...filter.params);
}

function getCurrentStockMap(db, divisionIds = null) {
  const rows = getCurrentStockRows(db, divisionIds);
  const map = new Map();
  rows.forEach((row) => map.set(row.id, row.stock));
  return map;
}

module.exports = { getCurrentStockRows, getCurrentStockMap };
