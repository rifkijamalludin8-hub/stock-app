function getCurrentStockRows(db) {
  const sql = `
    SELECT items.id,
      items.name,
      items.unit,
      items.min_stock,
      items.expiry_date,
      COALESCE(SUM(CASE WHEN t.type = 'IN' THEN t.qty ELSE -t.qty END), 0)
        + COALESCE((SELECT SUM(qty_delta) FROM adjustments a WHERE a.item_id = items.id), 0)
        AS stock
    FROM items
    LEFT JOIN transactions t ON t.item_id = items.id
    GROUP BY items.id
    ORDER BY items.name ASC
  `;
  return db.prepare(sql).all();
}

function getCurrentStockMap(db) {
  const rows = getCurrentStockRows(db);
  const map = new Map();
  rows.forEach((row) => map.set(row.id, row.stock));
  return map;
}

module.exports = { getCurrentStockRows, getCurrentStockMap };
