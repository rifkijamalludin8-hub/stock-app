const dayjs = require('dayjs');
const ExcelJS = require('exceljs');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const { listCompanies } = require('../db/master');
const { query } = require('../db/pg');
const { getReportRows } = require('./report');
const { formatDateTime } = require('./format');

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

async function buildTransactionsWorkbook(companyId) {
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

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Transaksi');
  sheet.columns = [
    { header: 'Tanggal', key: 'txn_date', width: 14 },
    { header: 'Tipe', key: 'type', width: 8 },
    { header: 'Item', key: 'item_label', width: 40 },
    { header: 'Qty', key: 'qty', width: 12 },
    { header: 'Harga/Unit', key: 'price_per_unit', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Catatan', key: 'note', width: 30 },
    { header: 'Dibuat Oleh', key: 'created_by_name', width: 20 },
    { header: 'Dibuat', key: 'created_at', width: 20 },
  ];

  rows.forEach((row) => {
    const itemLabel = `${row.group_name} - ${row.item_name} - ${row.expiry_date || '-'}`;
    sheet.addRow({
      txn_date: row.txn_date,
      type: row.type,
      item_label: itemLabel,
      qty: row.qty,
      price_per_unit: row.price_per_unit ?? null,
      note: row.note || '',
      created_by_name: row.created_by_name || '',
      created_at: formatDateTime(row.created_at),
    });
  });
  sheet.getRow(1).font = { bold: true };
  return workbook.xlsx.writeBuffer();
}

async function buildReportWorkbook(companyId, start, end) {
  const rows = await getReportRows({ query }, companyId, start, end, null);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Laporan');
  sheet.columns = [
    { header: 'Divisi', key: 'division_name', width: 22 },
    { header: 'Kelompok', key: 'group_name', width: 22 },
    { header: 'Item', key: 'item_name', width: 28 },
    { header: 'Expired', key: 'expiry_date', width: 14 },
    { header: 'Saldo Awal', key: 'opening', width: 12 },
    { header: 'Masuk', key: 'in_qty', width: 10 },
    { header: 'Keluar', key: 'out_qty', width: 10 },
    { header: 'Adjustment', key: 'adj_qty', width: 12 },
    { header: 'Saldo Akhir', key: 'closing', width: 12 },
    { header: 'Harga/Unit', key: 'price_per_unit', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Nilai Akhir', key: 'stock_value', width: 14, style: { numFmt: '#,##0.00' } },
  ];
  rows.forEach((row) => {
    sheet.addRow({
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
    });
  });
  sheet.getRow(1).font = { bold: true };
  return workbook.xlsx.writeBuffer();
}

async function buildDatabaseBackupWorkbook(companyId) {
  const workbook = new ExcelJS.Workbook();

  const divisions = await query(
    'SELECT id, name, description FROM divisions WHERE company_id = $1 ORDER BY name ASC',
    [companyId]
  );
  const divisionsSheet = workbook.addWorksheet('Divisi');
  divisionsSheet.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Nama', key: 'name', width: 24 },
    { header: 'Deskripsi', key: 'description', width: 40 },
  ];
  divisions.forEach((row) => divisionsSheet.addRow(row));
  divisionsSheet.getRow(1).font = { bold: true };

  const groups = await query(
    `SELECT g.id, g.name, g.description, d.name AS division_name
     FROM item_groups g
     JOIN divisions d ON d.id = g.division_id
     WHERE g.company_id = $1
     ORDER BY d.name ASC, g.name ASC`,
    [companyId]
  );
  const groupsSheet = workbook.addWorksheet('Jenis Barang');
  groupsSheet.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Divisi', key: 'division_name', width: 22 },
    { header: 'Nama', key: 'name', width: 26 },
    { header: 'Deskripsi', key: 'description', width: 40 },
  ];
  groups.forEach((row) => groupsSheet.addRow(row));
  groupsSheet.getRow(1).font = { bold: true };

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
  const itemsSheet = workbook.addWorksheet('Item');
  itemsSheet.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Divisi', key: 'division_name', width: 22 },
    { header: 'Jenis Barang', key: 'group_name', width: 22 },
    { header: 'Nama Item', key: 'name', width: 26 },
    { header: 'SKU', key: 'sku', width: 14 },
    { header: 'Satuan', key: 'unit', width: 10 },
    { header: 'Expired', key: 'expiry_date', width: 14 },
    { header: 'Min Stock', key: 'min_stock', width: 12 },
  ];
  items.forEach((row) => itemsSheet.addRow(row));
  itemsSheet.getRow(1).font = { bold: true };

  const users = await query(
    `SELECT id, name, email, role, created_at
     FROM users
     WHERE company_id = $1
     ORDER BY name ASC`,
    [companyId]
  );
  const usersSheet = workbook.addWorksheet('User');
  usersSheet.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Nama', key: 'name', width: 22 },
    { header: 'Email', key: 'email', width: 26 },
    { header: 'Role', key: 'role', width: 12 },
    { header: 'Dibuat', key: 'created_at', width: 20 },
  ];
  users.forEach((row) => usersSheet.addRow(row));
  usersSheet.getRow(1).font = { bold: true };

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
  const openingSheet = workbook.addWorksheet('Stock Awal');
  openingSheet.columns = [
    { header: 'Tanggal', key: 'opening_date', width: 14 },
    { header: 'Item', key: 'item_label', width: 36 },
    { header: 'Qty', key: 'qty', width: 12 },
    { header: 'Harga/Unit', key: 'price_per_unit', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Catatan', key: 'note', width: 30 },
    { header: 'Dibuat Oleh', key: 'created_by_name', width: 20 },
  ];
  opening.forEach((row) => {
    openingSheet.addRow({
      opening_date: row.opening_date,
      item_label: `${row.group_name} - ${row.item_name} - ${row.expiry_date || '-'}`,
      qty: row.qty,
      price_per_unit: row.price_per_unit ?? null,
      note: row.note || '',
      created_by_name: row.created_by_name || '',
    });
  });
  openingSheet.getRow(1).font = { bold: true };

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
  const txSheet = workbook.addWorksheet('Transaksi');
  txSheet.columns = [
    { header: 'Tanggal', key: 'txn_date', width: 14 },
    { header: 'Tipe', key: 'type', width: 8 },
    { header: 'Item', key: 'item_label', width: 40 },
    { header: 'Qty', key: 'qty', width: 12 },
    { header: 'Harga/Unit', key: 'price_per_unit', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Catatan', key: 'note', width: 30 },
    { header: 'Dibuat Oleh', key: 'created_by_name', width: 20 },
    { header: 'Dibuat', key: 'created_at', width: 20 },
  ];
  transactions.forEach((row) => {
    txSheet.addRow({
      txn_date: row.txn_date,
      type: row.type,
      item_label: `${row.group_name} - ${row.item_name} - ${row.expiry_date || '-'}`,
      qty: row.qty,
      price_per_unit: row.price_per_unit ?? null,
      note: row.note || '',
      created_by_name: row.created_by_name || '',
      created_at: formatDateTime(row.created_at),
    });
  });
  txSheet.getRow(1).font = { bold: true };

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
  const adjSheet = workbook.addWorksheet('Adjustment');
  adjSheet.columns = [
    { header: 'Tanggal', key: 'adj_date', width: 14 },
    { header: 'Item', key: 'item_label', width: 40 },
    { header: 'Qty Delta', key: 'qty_delta', width: 12 },
    { header: 'Catatan', key: 'note', width: 30 },
    { header: 'Dibuat Oleh', key: 'created_by_name', width: 20 },
    { header: 'Dibuat', key: 'created_at', width: 20 },
  ];
  adjustments.forEach((row) => {
    adjSheet.addRow({
      adj_date: row.adj_date,
      item_label: `${row.group_name} - ${row.item_name} - ${row.expiry_date || '-'}`,
      qty_delta: row.qty_delta,
      note: row.note || '',
      created_by_name: row.created_by_name || '',
      created_at: formatDateTime(row.created_at),
    });
  });
  adjSheet.getRow(1).font = { bold: true };

  return workbook.xlsx.writeBuffer();
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
    const txBuffer = await buildTransactionsWorkbook(company.id);
    const reportBuffer = await buildReportWorkbook(company.id, start, end);
    const dbBuffer = await buildDatabaseBackupWorkbook(company.id);
    const today = dayjs().format('YYYY-MM-DD');
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;

    await transporter.sendMail({
      from,
      to: primaryEmail,
      subject: `Backup ${company.name} - ${today}`,
      text: `Backup otomatis ${company.name}.\nPeriode transaksi & laporan: ${start} s/d ${end}.`,
      attachments: [
        {
          filename: `backup-${company.slug}-${today}.xlsx`,
          content: dbBuffer,
        },
        {
          filename: `transaksi-${start}-sd-${end}.xlsx`,
          content: txBuffer,
        },
        {
          filename: `laporan-${start}-sd-${end}.xlsx`,
          content: reportBuffer,
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

module.exports = { scheduleAutoBackup, runAutoBackup, buildDatabaseBackupWorkbook };
