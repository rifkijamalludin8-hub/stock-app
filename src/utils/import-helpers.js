const ExcelJS = require('exceljs');
const dayjs = require('dayjs');

const headerAliases = {
  item: 'item_label',
  'item label': 'item_label',
  label: 'item_label',
  'nama item': 'item_name',
  'item name': 'item_name',
  item_name: 'item_name',
  nama: 'item_name',
  jenis: 'group_name',
  kelompok: 'group_name',
  group: 'group_name',
  'group name': 'group_name',
  group_name: 'group_name',
  'jenis barang': 'group_name',
  exp: 'expiry_date',
  expired: 'expiry_date',
  expiry: 'expiry_date',
  'expiry date': 'expiry_date',
  'expired date': 'expiry_date',
  tanggal: 'date',
  tgl: 'date',
  date: 'date',
  qty: 'qty',
  jumlah: 'qty',
  'qty delta': 'qty_delta',
  qty_delta: 'qty_delta',
  harga: 'price_per_unit',
  'harga/unit': 'price_per_unit',
  'harga per unit': 'price_per_unit',
  price: 'price_per_unit',
  price_per_unit: 'price_per_unit',
  catatan: 'note',
  note: 'note',
  item_id: 'item_id',
  'id item': 'item_id',
  sku: 'sku',
};

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

function normalizeHeader(value) {
  if (value === null || value === undefined) return null;
  const raw = normalizeText(value).replace(/\s+/g, ' ');
  return headerAliases[raw] || null;
}

function normalizeCell(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if (value.text) return value.text;
    if (value.richText) return value.richText.map((r) => r.text).join('');
    if (Object.prototype.hasOwnProperty.call(value, 'result')) return value.result;
  }
  return value;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return dayjs(value).format('YYYY-MM-DD');
  if (typeof value === 'number') {
    const ms = Math.round((value - 25569) * 86400 * 1000);
    return dayjs(ms).format('YYYY-MM-DD');
  }
  const parsed = dayjs(String(value));
  if (!parsed.isValid()) return null;
  return parsed.format('YYYY-MM-DD');
}

async function readExcelRows(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { rows: [], headers: [] };

  const headerRow = sheet.getRow(1);
  const columnMap = {};
  const headers = [];
  headerRow.eachCell((cell, colNumber) => {
    const key = normalizeHeader(normalizeCell(cell.value));
    if (key) {
      columnMap[colNumber] = key;
      headers.push(key);
    }
  });

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const data = {};
    Object.keys(columnMap).forEach((colNumber) => {
      const key = columnMap[colNumber];
      const cellValue = normalizeCell(row.getCell(Number(colNumber)).value);
      data[key] = cellValue;
    });
    const hasValue = Object.values(data).some((v) => v !== null && v !== undefined && String(v).trim() !== '');
    if (!hasValue) return;
    rows.push({ rowNumber, data });
  });

  return { rows, headers };
}

async function buildItemLookup(db, companyId, divisionIds, filterClause, filterParams) {
  const rows = await db.query(
    `SELECT i.id, i.name, i.expiry_date, i.sku, g.name AS group_name, d.id AS division_id
     FROM items i
     JOIN item_groups g ON g.id = i.group_id
     JOIN divisions d ON d.id = g.division_id
     WHERE i.company_id = $1 ${filterClause}`,
    [companyId, ...filterParams]
  );

  const byId = new Map();
  const byLabel = new Map();
  const bySku = new Map();
  const byName = new Map();
  const byComposite = new Map();

  rows.forEach((row) => {
    byId.set(row.id, row);
    const expiry = row.expiry_date || '-';
    const label = normalizeText(`${row.group_name} - ${row.name} - ${expiry}`);
    byLabel.set(label, row);
    if (row.sku) bySku.set(normalizeText(row.sku), row);
    const nameKey = normalizeText(row.name);
    if (!byName.has(nameKey)) byName.set(nameKey, []);
    byName.get(nameKey).push(row);
    const compositeKey = normalizeText(`${row.group_name}|${row.name}|${row.expiry_date || ''}`);
    byComposite.set(compositeKey, row);
  });

  return { byId, byLabel, bySku, byName, byComposite };
}

function resolveItem(row, lookup) {
  if (row.item_id) {
    const id = Number(row.item_id);
    if (Number.isFinite(id) && lookup.byId.has(id)) return { item: lookup.byId.get(id) };
    return { error: 'Item ID tidak ditemukan' };
  }

  if (row.sku) {
    const skuKey = normalizeText(row.sku);
    if (lookup.bySku.has(skuKey)) return { item: lookup.bySku.get(skuKey) };
  }

  if (row.item_label) {
    const labelKey = normalizeText(row.item_label);
    if (lookup.byLabel.has(labelKey)) return { item: lookup.byLabel.get(labelKey) };
  }

  const itemName = row.item_name ? normalizeText(row.item_name) : '';
  const groupName = row.group_name ? normalizeText(row.group_name) : '';
  const expiryRaw = row.expiry_date ? parseDate(row.expiry_date) || String(row.expiry_date) : '';
  const expiry = normalizeText(expiryRaw);

  if (itemName && groupName) {
    const key = normalizeText(`${groupName}|${itemName}|${expiry || ''}`);
    if (lookup.byComposite.has(key)) return { item: lookup.byComposite.get(key) };
  }

  if (itemName) {
    const candidates = lookup.byName.get(itemName) || [];
    if (candidates.length === 1) return { item: candidates[0] };
    if (candidates.length > 1) return { error: 'Nama item ganda, isi Jenis Barang/Expired' };
  }

  return { error: 'Item tidak ditemukan' };
}

module.exports = {
  normalizeText,
  parseDate,
  readExcelRows,
  buildItemLookup,
  resolveItem,
};
