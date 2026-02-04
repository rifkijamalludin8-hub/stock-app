function getReportRows(db, startDate, endDate) {
  const sql = `
    WITH
      in_before AS (
        SELECT item_id, SUM(qty) qty
        FROM transactions
        WHERE type = 'IN' AND txn_date < ?
        GROUP BY item_id
      ),
      out_before AS (
        SELECT item_id, SUM(qty) qty
        FROM transactions
        WHERE type = 'OUT' AND txn_date < ?
        GROUP BY item_id
      ),
      adj_before AS (
        SELECT item_id, SUM(qty_delta) qty
        FROM adjustments
        WHERE adj_date < ?
        GROUP BY item_id
      ),
      in_range AS (
        SELECT item_id, SUM(qty) qty
        FROM transactions
        WHERE type = 'IN' AND txn_date BETWEEN ? AND ?
        GROUP BY item_id
      ),
      out_range AS (
        SELECT item_id, SUM(qty) qty
        FROM transactions
        WHERE type = 'OUT' AND txn_date BETWEEN ? AND ?
        GROUP BY item_id
      ),
      adj_range AS (
        SELECT item_id, SUM(qty_delta) qty
        FROM adjustments
        WHERE adj_date BETWEEN ? AND ?
        GROUP BY item_id
      )
    SELECT
      g.name AS group_name,
      i.id AS item_id,
      i.name AS item_name,
      i.expiry_date,
      i.unit,
      COALESCE(in_before.qty, 0) AS in_before,
      COALESCE(out_before.qty, 0) AS out_before,
      COALESCE(adj_before.qty, 0) AS adj_before,
      COALESCE(in_range.qty, 0) AS in_qty,
      COALESCE(out_range.qty, 0) AS out_qty,
      COALESCE(adj_range.qty, 0) AS adj_qty,
      (
        SELECT t.price_per_unit
        FROM transactions t
        WHERE t.item_id = i.id
          AND t.type = 'IN'
          AND t.txn_date <= ?
          AND t.price_per_unit IS NOT NULL
        ORDER BY t.txn_date DESC, t.id DESC
        LIMIT 1
      ) AS price_per_unit
    FROM items i
    JOIN item_groups g ON g.id = i.group_id
    LEFT JOIN in_before ON in_before.item_id = i.id
    LEFT JOIN out_before ON out_before.item_id = i.id
    LEFT JOIN adj_before ON adj_before.item_id = i.id
    LEFT JOIN in_range ON in_range.item_id = i.id
    LEFT JOIN out_range ON out_range.item_id = i.id
    LEFT JOIN adj_range ON adj_range.item_id = i.id
    ORDER BY g.name ASC, i.name ASC, i.expiry_date ASC
  `;

  const params = [
    startDate,
    startDate,
    startDate,
    startDate,
    endDate,
    startDate,
    endDate,
    startDate,
    endDate,
    endDate,
  ];

  const rows = db.prepare(sql).all(...params);

  return rows.map((row) => {
    const opening = row.in_before - row.out_before + row.adj_before;
    const closing = opening + row.in_qty - row.out_qty + row.adj_qty;
    return {
      group_name: row.group_name,
      item_id: row.item_id,
      item_name: row.item_name,
      expiry_date: row.expiry_date,
      unit: row.unit,
      opening,
      in_qty: row.in_qty,
      out_qty: row.out_qty,
      adj_qty: row.adj_qty,
      closing,
      price_per_unit: row.price_per_unit,
      stock_value:
        row.price_per_unit === null || row.price_per_unit === undefined
          ? null
          : closing * row.price_per_unit,
    };
  });
}

function groupReportRows(rows) {
  const grouped = [];
  const map = new Map();
  rows.forEach((row) => {
    if (!map.has(row.group_name)) {
      map.set(row.group_name, { name: row.group_name, items: [] });
      grouped.push(map.get(row.group_name));
    }
    map.get(row.group_name).items.push(row);
  });
  return grouped;
}

module.exports = { getReportRows, groupReportRows };
