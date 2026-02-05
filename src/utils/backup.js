const dayjs = require('dayjs');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const { listCompanies } = require('../db/master');
const { query } = require('../db/pg');
const { getReportRows } = require('./report');
const { formatDateTime } = require('./format');

function toCsvValue(value) {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return '"' + stringValue.replace(/"/g, '""') + '"';
  }
  return stringValue;
}

function buildCsv(columns, rows) {
  const header = columns.map((col) => toCsvValue(col.header)).join(',');
  const body = rows
    .map((row) =>
      columns
        .map((col) => {
          const raw = row[col.key];
          const value = col.format ? col.format(raw) : raw;
          return toCsvValue(value);
        })
        .join(',')
    )
    .join('\n');
  return header + '\n' + body;
}

async function getPrimaryUserEmail(companyId) {
  const rows = await query(
    "SELECT email FROM users WHERE company_id = $1 AND role = 'user' ORDER BY id ASC LIMIT 1",
    [companyId]
  );
  return rows[0] ? rows[0].email : null;
}

async function resolveDateRange(companyId) {
  const ranges = await Promise.all([
    query('SELECT MIN(txn_date) AS min, MAX(txn_date) AS max FROM transactions WHERE company_id = $1', [
      companyId,
    ]),
    query('SELECT MIN(adj_date) AS min, MAX(adj_date) AS max FROM adjustments WHERE company_id = $1', [
      companyId,
    ]),
    query(
      'SELECT MIN(opening_date) AS min, MAX(opening_date) AS max FROM opening_balances WHERE company_id = $1',
      [companyId]
    ),
  ]);
  const minDates = ranges.map((r) => r[0]?.min).filter(Boolean);
  const maxDates = ranges.map((r) => r[0]?.max).filter(Boolean);
  if (minDates.length === 0 || maxDates.length === 0) {
    const today = dayjs().format('YYYY-MM-DD');
    return { start: today, end: today };
  }
  const start = minDates.reduce((a, b) => (a < b ? a : b));
  const end = maxDates.reduce((a, b) => (a > b ? a : b));
  return { start, end };
}

async function buildTransactionsCsv(companyId) {
  const rows = await query(
    `SELECT t.txn_date,
            t.type,
            t.qty,
            t.price_per_unit,
            t.note,
            t.created_at,
            u.name AS created_by_name,
            g.name AS group_name,
            i.name AS item_name,
            i.expiry_date
     FROM transactions t
     JOIN items i ON i.id = t.item_id
     JOIN item_groups g ON g.id = i.group_id
     LEFT JOIN users u ON u.id = t.created_by
     WHERE t.company_id = $1
     ORDER BY t.txn_date ASC, t.id ASC`,
    [companyId]
  );

  const columns = [
    { header: 'Tanggal', key: 'txn_date' },
    { header: 'Tipe', key: 'type' },
    { header: 'Item', key: 'item_label' },
    { header: 'Qty', key: 'qty' },
    { header: 'Harga/Unit', key: 'price_per_unit' },
    { header: 'Catatan', key: 'note' },
    { header: 'Dibuat Oleh', key: 'created_by_name' },
    { header: 'Dibuat', key: 'created_at', format: formatDateTime },
  ];
  const data = rows.map((row) => ({
    txn_date: row.txn_date,
    type: row.type,
    item_label: `${row.group_name} - ${row.item_name} - ${row.expiry_date || '-'}`,
    qty: row.qty,
    price_per_unit: row.price_per_unit ?? null,
    note: row.note || '',
    created_by_name: row.created_by_name || '',
    created_at: row.created_at,
  }));
  return buildCsv(columns, data);
}

async function buildReportCsv(companyId, start, end) {
  const rows = await getReportRows({ query }, companyId, start, end, null);
  const columns = [
    { header: 'Divisi', key: 'division_name' },
    { header: 'Kelompok', key: 'group_name' },
    { header: 'Item', key: 'item_name' },
    { header: 'Expired', key: 'expiry_date' },
    { header: 'Saldo Awal', key: 'opening' },
    { header: 'Masuk', key: 'in_qty' },
    { header: 'Keluar', key: 'out_qty' },
    { header: 'Adjustment', key: 'adj_qty' },
    { header: 'Saldo Akhir', key: 'closing' },
    { header: 'Harga/Unit', key: 'price_per_unit' },
    { header: 'Nilai Akhir', key: 'stock_value' },
  ];
  const data = rows.map((row) => ({
    division_name: row.division_name,
    group_name: row.group_name,
    item_name: row.item_name,
    expiry_date: row.expiry_date || '-',
    opening: row.opening,
    in_qty: row.in_qty,
    out_qty: row.out_qty,
    adj_qty: row.adj_qty,
    closing: row.closing,
    price_per_unit: row.price_per_unit ?? null,
    stock_value: row.stock_value ?? null,
  }));
  return buildCsv(columns, data);
}

async function buildDatabaseBackupCsv(companyId) {
  const divisions = await query(
    'SELECT id, name, description FROM divisions WHERE company_id = $1 ORDER BY name ASC',
    [companyId]
  );
  const divisionsCsv = buildCsv(
    [
      { header: 'ID', key: 'id' },
      { header: 'Nama', key: 'name' },
      { header: 'Deskripsi', key: 'description' },
    ],
    divisions
  );

  const groups = await query(
    `SELECT g.id, g.name, g.description, d.name AS division_name
     FROM item_groups g
     JOIN divisions d ON d.id = g.division_id
     WHERE g.company_id = $1
     ORDER BY d.name ASC, g.name ASC`,
    [companyId]
  );
  const groupsCsv = buildCsv(
    [
      { header: 'ID', key: 'id' },
      { header: 'Divisi', key: 'division_name' },
      { header: 'Nama', key: 'name' },
      { header: 'Deskripsi', key: 'description' },
    ],
    groups
  );

  const items = await query(
    `SELECT i.id,
            i.name,
            i.sku,
            i.unit,
            i.expiry_date,
            i.min_stock,
            g.name AS group_name,
            d.name AS division_name
     FROM items i
     JOIN item_groups g ON g.id = i.group_id
     JOIN divisions d ON d.id = g.division_id
     WHERE i.company_id = $1
     ORDER BY d.name ASC, g.name ASC, i.name ASC`,
    [companyId]
  );
  const itemsCsv = buildCsv(
    [
      { header: 'ID', key: 'id' },
      { header: 'Divisi', key: 'division_name' },
      { header: 'Jenis Barang', key: 'group_name' },
      { header: 'Nama Item', key: 'name' },
      { header: 'SKU', key: 'sku' },
      { header: 'Satuan', key: 'unit' },
      { header: 'Expired', key: 'expiry_date' },
      { header: 'Min Stock', key: 'min_stock' },
    ],
    items
  );

  const users = await query(
    `SELECT id, name, email, role, created_at
     FROM users
     WHERE company_id = $1
     ORDER BY name ASC`,
    [companyId]
  );
  const usersCsv = buildCsv(
    [
      { header: 'ID', key: 'id' },
      { header: 'Nama', key: 'name' },
      { header: 'Email', key: 'email' },
      { header: 'Role', key: 'role' },
      { header: 'Dibuat', key: 'created_at' },
    ],
    users
  );

  const opening = await query(
    `SELECT ob.opening_date,
            ob.qty,
            ob.price_per_unit,
            ob.note,
            u.name AS created_by_name,
            i.name AS item_name,
            g.name AS group_name,
            i.expiry_date
     FROM opening_balances ob
     JOIN items i ON i.id = ob.item_id
     JOIN item_groups g ON g.id = i.group_id
     LEFT JOIN users u ON u.id = ob.created_by
     WHERE ob.company_id = $1
     ORDER BY ob.opening_date ASC, ob.id ASC`,
    [companyId]
  );
  const openingCsv = buildCsv(
    [
      { header: 'Tanggal', key: 'opening_date' },
      { header: 'Item', key: 'item_label' },
      { header: 'Qty', key: 'qty' },
      { header: 'Harga/Unit', key: 'price_per_unit' },
      { header: 'Catatan', key: 'note' },
      { header: 'Dibuat Oleh', key: 'created_by_name' },
    ],
    opening.map((row) => ({
      opening_date: row.opening_date,
      item_label: `${row.group_name} - ${row.item_name} - ${row.expiry_date || '-'}`,
      qty: row.qty,
      price_per_unit: row.price_per_unit ?? null,
      note: row.note || '',
      created_by_name: row.created_by_name || '',
    }))
  );

  const transactions = await query(
    `SELECT t.txn_date,
            t.type,
            t.qty,
            t.price_per_unit,
            t.note,
            t.created_at,
            u.name AS created_by_name,
            g.name AS group_name,
            i.name AS item_name,
            i.expiry_date
     FROM transactions t
     JOIN items i ON i.id = t.item_id
     JOIN item_groups g ON g.id = i.group_id
     LEFT JOIN users u ON u.id = t.created_by
     WHERE t.company_id = $1
     ORDER BY t.txn_date ASC, t.id ASC`,
    [companyId]
  );
  const transactionsCsv = buildCsv(
    [
      { header: 'Tanggal', key: 'txn_date' },
      { header: 'Tipe', key: 'type' },
      { header: 'Item', key: 'item_label' },
      { header: 'Qty', key: 'qty' },
      { header: 'Harga/Unit', key: 'price_per_unit' },
      { header: 'Catatan', key: 'note' },
      { header: 'Dibuat Oleh', key: 'created_by_name' },
      { header: 'Dibuat', key: 'created_at', format: formatDateTime },
    ],
    transactions.map((row) => ({
      txn_date: row.txn_date,
      type: row.type,
      item_label: `${row.group_name} - ${row.item_name} - ${row.expiry_date || '-'}`,
      qty: row.qty,
      price_per_unit: row.price_per_unit ?? null,
      note: row.note || '',
      created_by_name: row.created_by_name || '',
      created_at: row.created_at,
    }))
  );

  const adjustments = await query(
    `SELECT a.adj_date,
            a.qty_delta,
            a.note,
            a.created_at,
            u.name AS created_by_name,
            g.name AS group_name,
            i.name AS item_name,
            i.expiry_date
     FROM adjustments a
     JOIN items i ON i.id = a.item_id
     JOIN item_groups g ON g.id = i.group_id
     LEFT JOIN users u ON u.id = a.created_by
     WHERE a.company_id = $1
     ORDER BY a.adj_date ASC, a.id ASC`,
    [companyId]
  );
  const adjustmentsCsv = buildCsv(
    [
      { header: 'Tanggal', key: 'adj_date' },
      { header: 'Item', key: 'item_label' },
      { header: 'Qty Delta', key: 'qty_delta' },
      { header: 'Catatan', key: 'note' },
      { header: 'Dibuat Oleh', key: 'created_by_name' },
      { header: 'Dibuat', key: 'created_at', format: formatDateTime },
    ],
    adjustments.map((row) => ({
      adj_date: row.adj_date,
      item_label: `${row.group_name} - ${row.item_name} - ${row.expiry_date || '-'}`,
      qty_delta: row.qty_delta,
      note: row.note || '',
      created_by_name: row.created_by_name || '',
      created_at: row.created_at,
    }))
  );

  const sections = [
    ['Divisi', divisionsCsv],
    ['Jenis Barang', groupsCsv],
    ['Item', itemsCsv],
    ['User', usersCsv],
    ['Stock Awal', openingCsv],
    ['Transaksi', transactionsCsv],
    ['Adjustment', adjustmentsCsv],
  ];

  return sections
    .map(([title, csv]) => `# ${title}\n${csv}`)
    .join('\n\n');
}

function createTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: SMTP_SECURE === 'true',
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
}

async function sendCompanyBackup(company) {
  const transporter = createTransporter();
  if (!transporter) {
    console.log('Auto backup disabled: SMTP not configured.');
    return;
  }

  try {
    const primaryEmail = await getPrimaryUserEmail(company.id);
    if (!primaryEmail) {
      console.log(`Backup skipped for ${company.name}: no user utama email.`);
      return;
    }

    const { start, end } = await resolveDateRange(company.id);
    const txCsv = await buildTransactionsCsv(company.id);
    const reportCsv = await buildReportCsv(company.id, start, end);
    const dbCsv = await buildDatabaseBackupCsv(company.id);
    const today = dayjs().format('YYYY-MM-DD');
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;

    await transporter.sendMail({
      from,
      to: primaryEmail,
      subject: `Backup ${company.name} - ${today}`,
      text: `Backup otomatis ${company.name}.\nPeriode transaksi & laporan: ${start} s/d ${end}.`,
      attachments: [
        {
          filename: `backup-${company.slug}-${today}.csv`,
          content: dbCsv,
        },
        {
          filename: `transaksi-${start}-sd-${end}.csv`,
          content: txCsv,
        },
        {
          filename: `laporan-${start}-sd-${end}.csv`,
          content: reportCsv,
        },
      ],
    });
    console.log(`Backup sent to ${primaryEmail} (${company.name}).`);
  } finally {
    return;
  }
}

async function runAutoBackup() {
  const companies = await listCompanies();
  if (!companies.length) {
    console.log('Auto backup skipped: no companies.');
    return;
  }
  for (const company of companies) {
    try {
      await sendCompanyBackup(company);
    } catch (err) {
      console.error(`Backup failed for ${company.name}:`, err);
    }
  }
}

function scheduleAutoBackup() {
  if (process.env.AUTO_BACKUP_ENABLED === 'false') return;
  const transporter = createTransporter();
  if (!transporter) {
    console.log('Auto backup scheduler not started: SMTP not configured.');
    return;
  }
  const cronExpr = process.env.BACKUP_CRON || '0 8 * * 1';
  const timezone = process.env.BACKUP_TZ || 'Asia/Jakarta';
  if (!cron.validate(cronExpr)) {
    console.log('Invalid BACKUP_CRON, scheduler disabled.');
    return;
  }
  cron.schedule(cronExpr, () => {
    runAutoBackup();
  }, { timezone });
  console.log(`Auto backup scheduled: ${cronExpr} (${timezone})`);
}

module.exports = { scheduleAutoBackup, runAutoBackup, buildDatabaseBackupCsv };
