const { buildDivisionFilter } = require('./division');
const { getReportRows } = require('./report');

function buildItemLabel(row) {
  const expiry = row.expiry_date || '-';
  return `${row.group_name} - ${row.item_name} - ${expiry}`;
}

async function getMutationRows(db, companyId, start, end, divisionIds = null, itemId = null) {
  const reportRows = await getReportRows(db, companyId, start, end, divisionIds);
  const itemMap = new Map();
  reportRows.forEach((row) => {
    itemMap.set(row.item_id, {
      item_id: row.item_id,
      division_name: row.division_name,
      group_name: row.group_name,
      item_name: row.item_name,
      expiry_date: row.expiry_date,
      unit: row.unit,
      opening: Number(row.opening || 0),
      label: buildItemLabel(row),
    });
  });

  if (itemId) {
    const only = itemMap.get(Number(itemId));
    itemMap.clear();
    if (only) itemMap.set(Number(itemId), only);
  }

  const filter = buildDivisionFilter(divisionIds, 'd.id', 2);
  let idx = filter.nextIndex;
  const startIdx = idx++;
  const endIdx = idx++;
  const params = [companyId, ...filter.params, start, end];
  let itemClause = '';
  if (itemId) {
    itemClause = ` AND i.id = $${idx++}`;
    params.push(itemId);
  }

  const events = await db.query(
    `SELECT e.item_id,
            e.event_date,
            e.type,
            e.qty,
            e.note,
            e.created_at,
            e.sort_id,
            u.name AS created_by_name,
            i.name AS item_name,
            g.name AS group_name,
            d.name AS division_name,
            i.expiry_date,
            i.unit
     FROM (
       SELECT t.item_id, t.txn_date AS event_date, t.type AS type, t.qty AS qty,
              t.note, t.created_at, t.id AS sort_id, t.created_by
       FROM transactions t
       WHERE t.company_id = $1 AND t.txn_date BETWEEN $${startIdx} AND $${endIdx}
       UNION ALL
       SELECT a.item_id, a.adj_date AS event_date, 'ADJ' AS type, a.qty_delta AS qty,
              a.note, a.created_at, a.id AS sort_id, a.created_by
       FROM adjustments a
       WHERE a.company_id = $1 AND a.adj_date BETWEEN $${startIdx} AND $${endIdx}
       UNION ALL
       SELECT ob.item_id, ob.opening_date AS event_date, 'OPENING' AS type, ob.qty AS qty,
              ob.note, ob.created_at, ob.id AS sort_id, ob.created_by
       FROM opening_balances ob
       WHERE ob.company_id = $1 AND ob.opening_date > $${startIdx} AND ob.opening_date <= $${endIdx}
     ) e
     JOIN items i ON i.id = e.item_id
     JOIN item_groups g ON g.id = i.group_id
     JOIN divisions d ON d.id = g.division_id
     LEFT JOIN users u ON u.id = e.created_by
     WHERE i.company_id = $1 ${filter.clause} ${itemClause}
     ORDER BY e.event_date ASC, e.sort_id ASC`,
    params
  );

  // Ensure items seen in events but not in reportRows are included
  events.forEach((row) => {
    if (!itemMap.has(row.item_id)) {
      itemMap.set(row.item_id, {
        item_id: row.item_id,
        division_name: row.division_name,
        group_name: row.group_name,
        item_name: row.item_name,
        expiry_date: row.expiry_date,
        unit: row.unit,
        opening: 0,
        label: buildItemLabel(row),
      });
    }
  });

  const eventsByItem = new Map();
  events.forEach((row) => {
    if (!eventsByItem.has(row.item_id)) eventsByItem.set(row.item_id, []);
    eventsByItem.get(row.item_id).push(row);
  });

  const orderedItems = Array.from(itemMap.values()).sort((a, b) => {
    return (a.division_name || '').localeCompare(b.division_name || '') ||
      (a.group_name || '').localeCompare(b.group_name || '') ||
      (a.item_name || '').localeCompare(b.item_name || '');
  });

  const grouped = [];
  const flatRows = [];

  orderedItems.forEach((item) => {
    const movements = [];
    let running = Number(item.opening || 0);
    movements.push({
      item_label: item.label,
      event_date: start,
      type: 'SALDO AWAL',
      qty: running,
      saldo: running,
      note: 'Saldo awal',
      created_by_name: '',
      created_at: null,
    });

    const itemEvents = eventsByItem.get(item.item_id) || [];
    itemEvents.forEach((ev) => {
      const qtyValue = Number(ev.qty || 0);
      let delta = qtyValue;
      if (ev.type === 'OUT') delta = -qtyValue;
      if (ev.type === 'ADJ') delta = qtyValue;
      if (ev.type === 'OPENING') delta = qtyValue;
      running += delta;
      const row = {
        item_label: item.label,
        event_date: ev.event_date,
        type: ev.type,
        qty: qtyValue,
        saldo: running,
        note: ev.note || '',
        created_by_name: ev.created_by_name || '',
        created_at: ev.created_at,
      };
      movements.push(row);
    });

    grouped.push({ item, rows: movements });
    movements.forEach((row) => flatRows.push(row));
  });

  return { grouped, flatRows };
}

module.exports = { getMutationRows };
