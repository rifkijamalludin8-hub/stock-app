const express = require('express');
const dayjs = require('dayjs');
const { requireCompany, requireAuth, canSeePrice } = require('../utils/auth');
const { exportCsv, exportExcel, exportPdf } = require('../utils/export');
const { getReportRows } = require('../utils/report');
const { getCurrentStockRows } = require('../utils/stock');

const router = express.Router();

router.get('/export/:resource', requireCompany, requireAuth, async (req, res) => {
  const { resource } = req.params;
  const format = (req.query.format || 'xlsx').toLowerCase();
  const db = req.db;
  const showPrice = canSeePrice(req);

  let columns = [];
  let rows = [];
  let title = 'Export';
  let filename = `${resource}-${dayjs().format('YYYYMMDD')}`;

  if (resource === 'groups') {
    title = 'Daftar Kelompok Barang';
    columns = [
      { header: 'Nama Kelompok', key: 'name', width: 30 },
      { header: 'Deskripsi', key: 'description', width: 40 },
    ];
    rows = db.prepare('SELECT name, description FROM item_groups ORDER BY name ASC').all();
  }

  if (resource === 'items') {
    title = 'Daftar Item';
    const stockRows = getCurrentStockRows(db);
    const stockMap = new Map(stockRows.map((row) => [row.id, row.stock]));
    columns = [
      { header: 'Kelompok', key: 'group_name', width: 24 },
      { header: 'Nama Item', key: 'name', width: 30 },
      { header: 'SKU', key: 'sku', width: 16 },
      { header: 'Satuan', key: 'unit', width: 10 },
      { header: 'Expired', key: 'expiry_date', width: 14 },
      { header: 'Min Stock', key: 'min_stock', width: 12 },
      { header: 'Stock', key: 'stock', width: 12 },
    ];
    rows = db
      .prepare(
        `SELECT i.*, g.name AS group_name
         FROM items i
         JOIN item_groups g ON g.id = i.group_id
         ORDER BY g.name ASC, i.name ASC`
      )
      .all()
      .map((row) => ({
        ...row,
        stock: stockMap.get(row.id) || 0,
      }));
  }

  if (resource === 'transactions') {
    title = 'Daftar Transaksi';
    columns = [
      { header: 'Tanggal', key: 'txn_date', width: 14 },
      { header: 'Tipe', key: 'type', width: 8 },
      { header: 'Item', key: 'item_name', width: 30 },
      { header: 'Qty', key: 'qty', width: 12 },
      { header: 'Harga/Unit', key: 'price_per_unit', width: 14 },
      { header: 'Catatan', key: 'note', width: 30 },
    ];
    rows = db
      .prepare(
        `SELECT t.txn_date, t.type, t.qty, t.price_per_unit, t.note, i.name AS item_name
         FROM transactions t
         JOIN items i ON i.id = t.item_id
         ORDER BY t.txn_date DESC, t.id DESC`
      )
      .all();
    if (!showPrice) {
      columns = columns.filter((col) => col.key !== 'price_per_unit');
      rows = rows.map(({ price_per_unit, ...rest }) => rest);
    }
  }

  if (resource === 'adjustments') {
    if (!showPrice) {
      return res.status(403).send('Tidak punya akses untuk export adjustment');
    }
    title = 'Daftar Adjustment';
    columns = [
      { header: 'Tanggal', key: 'adj_date', width: 14 },
      { header: 'Item', key: 'item_name', width: 30 },
      { header: 'Qty Delta', key: 'qty_delta', width: 12 },
      { header: 'Catatan', key: 'note', width: 30 },
    ];
    rows = db
      .prepare(
        `SELECT a.adj_date, a.qty_delta, a.note, i.name AS item_name
         FROM adjustments a
         JOIN items i ON i.id = a.item_id
         ORDER BY a.adj_date DESC, a.id DESC`
      )
      .all();
  }

  if (resource === 'users') {
    if (!showPrice) {
      return res.status(403).send('Tidak punya akses untuk export user');
    }
    title = 'Daftar User';
    columns = [
      { header: 'Nama', key: 'name', width: 24 },
      { header: 'Email', key: 'email', width: 28 },
      { header: 'Role', key: 'role', width: 12 },
      { header: 'Dibuat', key: 'created_at', width: 20 },
    ];
    rows = db.prepare('SELECT name, email, role, created_at FROM users ORDER BY name ASC').all();
  }

  if (resource === 'report') {
    const start = req.query.start;
    const end = req.query.end;
    if (!start || !end) return res.status(400).send('Start/end wajib diisi');
    title = 'Laporan Stock';
    filename = `laporan-stock-${start}-sd-${end}`;
    const reportRows = getReportRows(db, start, end);
    columns = [
      { header: 'Kelompok', key: 'group_name', width: 22 },
      { header: 'Item', key: 'item_name', width: 26 },
      { header: 'Expired', key: 'expiry_date', width: 14 },
      { header: 'Saldo Awal', key: 'opening', width: 12 },
      { header: 'Masuk', key: 'in_qty', width: 10 },
      { header: 'Keluar', key: 'out_qty', width: 10 },
      { header: 'Adjustment', key: 'adj_qty', width: 12 },
      { header: 'Saldo Akhir', key: 'closing', width: 12 },
      { header: 'Harga/Unit', key: 'price_per_unit', width: 14 },
      { header: 'Nilai Akhir', key: 'stock_value', width: 14 },
    ];
    rows = reportRows;
    if (!showPrice) {
      columns = columns.filter((col) => !['price_per_unit', 'stock_value'].includes(col.key));
      rows = rows.map(({ price_per_unit, stock_value, ...rest }) => rest);
    }
  }

  if (columns.length === 0) return res.status(404).send('Resource tidak ditemukan');

  if (format === 'csv') return exportCsv(res, filename, columns, rows);
  if (format === 'xlsx') return await exportExcel(res, filename, columns, rows);
  if (format === 'pdf') return exportPdf(res, filename, title, columns, rows);

  return res.status(400).send('Format tidak dikenali');
});

module.exports = router;
