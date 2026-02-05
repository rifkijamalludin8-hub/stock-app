const { buildDivisionFilter } = require('./division');

async function getReportRows(db, companyId, startDate, endDate, divisionIds = null) {
  const filter = buildDivisionFilter(divisionIds, 'd.id', 12);
  const sql = `
    WITH
      in_before AS (
        SELECT item_id, SUM(qty) qty
        FROM transactions
        WHERE type = 'IN' AND txn_date < $2 AND company_id = $1
        GROUP BY item_id
      ),
      out_before AS (
        SELECT item_id, SUM(qty) qty
        FROM transactions
        WHERE type = 'OUT' AND txn_date < $3 AND company_id = $1
        GROUP BY item_id
      ),
      adj_before AS (
        SELECT item_id, SUM(qty_delta) qty
        FROM adjustments
        WHERE adj_date < $4 AND company_id = $1
        GROUP BY item_id
      ),
      opening_before AS (
        SELECT item_id, SUM(qty) qty
        FROM opening_balances
        WHERE opening_date <= $5 AND company_id = $1
        GROUP BY item_id
      ),
      in_range AS (
        SELECT item_id, SUM(qty) qty
        FROM transactions
        WHERE type = 'IN' AND txn_date BETWEEN $6 AND $7 AND company_id = $1
        GROUP BY item_id
      ),
      out_range AS (
        SELECT item_id, SUM(qty) qty
        FROM transactions
        WHERE type = 'OUT' AND txn_date BETWEEN $8 AND $9 AND company_id = $1
        GROUP BY item_id
      ),
      adj_range AS (
        SELECT item_id, SUM(qty_delta) qty
        FROM adjustments
        WHERE adj_date BETWEEN $10 AND $11 AND company_id = $1
        GROUP BY item_id
      )
    SELECT
      d.name AS division_name,
      g.name AS group_name,
      i.id AS item_id,
      i.name AS item_name,
      i.expiry_date,
      i.unit,
      COALESCE(opening_before.qty, 0) AS opening_qty,
      COALESCE(in_before.qty, 0) AS in_before,
      COALESCE(out_before.qty, 0) AS out_before,
      COALESCE(adj_before.qty, 0) AS adj_before,
      COALESCE(in_range.qty, 0) AS in_qty,
      COALESCE(out_range.qty, 0) AS out_qty,
      COALESCE(adj_range.qty, 0) AS adj_qty,
      (
        SELECT price_per_unit FROM (
          SELECT t.txn_date AS dt, t.price_per_unit
          FROM transactions t
          WHERE t.item_id = i.id
            AND t.type = 'IN'
            AND t.price_per_unit IS NOT NULL
            AND t.company_id = $1
          UNION ALL
          SELECT ob.opening_date AS dt, ob.price_per_unit
          FROM opening_balances ob
          WHERE ob.item_id = i.id
            AND ob.price_per_unit IS NOT NULL
            AND ob.company_id = $1
        )
        WHERE dt <= $11
        ORDER BY dt DESC
        LIMIT 1
      ) AS price_per_unit
    FROM items i
    JOIN item_groups g ON g.id = i.group_id
    JOIN divisions d ON d.id = g.division_id
    LEFT JOIN in_before ON in_before.item_id = i.id
    LEFT JOIN out_before ON out_before.item_id = i.id
    LEFT JOIN adj_before ON adj_before.item_id = i.id
    LEFT JOIN opening_before ON opening_before.item_id = i.id
    LEFT JOIN in_range ON in_range.item_id = i.id
    LEFT JOIN out_range ON out_range.item_id = i.id
    LEFT JOIN adj_range ON adj_range.item_id = i.id
    WHERE i.company_id = $1 ${filter.clause}
    ORDER BY d.name ASC, g.name ASC, i.name ASC, i.expiry_date ASC
  `;

  const params = [
    companyId,
    startDate,
    startDate,
    startDate,
    startDate,
    startDate,
    endDate,
    startDate,
    endDate,
    startDate,
    endDate,
  ];

  const rows = await db.query(sql, [...params, ...filter.params]);

  return rows.map((row) => {
    const opening = row.opening_qty + row.in_before - row.out_before + row.adj_before;
    const closing = opening + row.in_qty - row.out_qty + row.adj_qty;
    return {
      division_name: row.division_name,
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
  const divisions = [];
  const divMap = new Map();
  rows.forEach((row) => {
    if (!divMap.has(row.division_name)) {
      divMap.set(row.division_name, { name: row.division_name, groups: [] });
      divisions.push(divMap.get(row.division_name));
    }
    const division = divMap.get(row.division_name);
    if (!division.groupMap) division.groupMap = new Map();
    if (!division.groupMap.has(row.group_name)) {
      const group = { name: row.group_name, items: [] };
      division.groupMap.set(row.group_name, group);
      division.groups.push(group);
    }
    division.groupMap.get(row.group_name).items.push(row);
  });
  divisions.forEach((div) => delete div.groupMap);
  return divisions;
}

module.exports = { getReportRows, groupReportRows };
