const express = require('express');
const dayjs = require('dayjs');
const fs = require('fs');
const path = require('path');
const { requireCompany, requireAuth, requireRole } = require('../utils/auth');
const { divisionAccess, buildDivisionFilter } = require('../utils/division');
const { setFlash } = require('../utils/flash');
const { createProofUpload } = require('../utils/proof-upload');
const { createExcelUpload } = require('../utils/excel-upload');
const { readExcelRows, buildItemLookup, resolveItem, parseDate } = require('../utils/import-helpers');

const router = express.Router();
const upload = createProofUpload('adj');
const excelUpload = createExcelUpload('adjustment');

router.get('/adjustments', requireCompany, requireAuth, requireRole('user'), divisionAccess, (req, res) => {
  const db = req.db;
  const filter = buildDivisionFilter(req.divisionIds, 'd.id');
  const items = db
    .prepare(
      `SELECT i.id, i.name, i.expiry_date, g.name AS group_name
       FROM items i
       JOIN item_groups g ON g.id = i.group_id
       JOIN divisions d ON d.id = g.division_id
       WHERE 1=1 ${filter.clause}
       ORDER BY g.name ASC, i.name ASC`
    )
    .all(...filter.params);
  const adjustments = db
    .prepare(
      `SELECT a.*,
              (g.name || ' - ' || i.name || ' - ' || COALESCE(i.expiry_date, '-')) AS item_label,
              u.name AS created_by_name
       FROM adjustments a
       JOIN items i ON i.id = a.item_id
       JOIN item_groups g ON g.id = i.group_id
       JOIN divisions d ON d.id = g.division_id
       LEFT JOIN users u ON u.id = a.created_by
       WHERE 1=1 ${filter.clause}
       ORDER BY a.adj_date DESC, a.id DESC
       LIMIT 50`
    )
    .all(...filter.params);
  res.render('pages/adjustments', {
    items,
    adjustments,
    today: dayjs().format('YYYY-MM-DD'),
  });
});

router.post('/adjustments', requireCompany, requireAuth, requireRole('user'), (req, res) => {
  upload.single('proof')(req, res, (err) => {
    if (err) {
      setFlash(req, 'error', err.message || 'Upload bukti gagal.');
      return res.redirect('/adjustments');
    }

    const db = req.db;
    const { item_id, qty_delta, note, adj_date } = req.body;
    if (!item_id || !qty_delta) {
      setFlash(req, 'error', 'Item dan jumlah adjustment wajib diisi.');
      return res.redirect('/adjustments');
    }
    const proofPath = req.file ? path.join('uploads', 'proofs', req.file.filename) : null;
    try {
      db.prepare(
        `INSERT INTO adjustments (item_id, qty_delta, proof_path, note, adj_date, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        item_id,
        Number(qty_delta),
        proofPath,
        note || null,
        adj_date || dayjs().format('YYYY-MM-DD'),
        req.session.user.id,
        new Date().toISOString()
      );
      setFlash(req, 'success', 'Adjustment berhasil ditambahkan.');
    } catch (err) {
      setFlash(req, 'error', 'Gagal menambahkan adjustment.');
    }

    return res.redirect('/adjustments');
  });
});

router.post('/adjustments/import', requireCompany, requireAuth, requireRole('user'), divisionAccess, (req, res) => {
  excelUpload.single('file')(req, res, async (err) => {
    if (err) {
      setFlash(req, 'error', err.message || 'Upload gagal.');
      return res.redirect('/adjustments');
    }
    if (!req.file) {
      setFlash(req, 'error', 'File Excel wajib diunggah.');
      return res.redirect('/adjustments');
    }

    const db = req.db;
    const filter = buildDivisionFilter(req.divisionIds, 'd.id');
    try {
      const { rows, headers } = await readExcelRows(req.file.path);
      if (rows.length === 0) {
        setFlash(req, 'error', 'File Excel kosong atau format tidak dikenali.');
        return res.redirect('/adjustments');
      }
      const hasItemHeader = headers.includes('item_id') || headers.includes('item_label') || headers.includes('item_name');
      if (!hasItemHeader) {
        setFlash(req, 'error', 'Kolom item tidak ditemukan. Gunakan Item atau Nama Item/Jenis Barang.');
        return res.redirect('/adjustments');
      }
      const hasQty = headers.includes('qty') || headers.includes('qty_delta');
      if (!hasQty) {
        setFlash(req, 'error', 'Kolom Qty/Qty Delta wajib ada.');
        return res.redirect('/adjustments');
      }

      const lookup = buildItemLookup(db, req.divisionIds, filter.clause, filter.params);
      const insert = db.prepare(
        `INSERT INTO adjustments (item_id, qty_delta, proof_path, note, adj_date, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      const now = new Date().toISOString();
      const payloads = [];
      const errors = [];

      rows.forEach(({ rowNumber, data }) => {
        const { item, error } = resolveItem(data, lookup);
        if (error) {
          errors.push(`Baris ${rowNumber}: ${error}`);
          return;
        }

        const qtyValue = data.qty_delta !== undefined && data.qty_delta !== null ? data.qty_delta : data.qty;
        const qtyDelta = Number(qtyValue);
        if (!Number.isFinite(qtyDelta)) {
          errors.push(`Baris ${rowNumber}: Qty Delta tidak valid`);
          return;
        }

        const adjDate = parseDate(data.date) || dayjs().format('YYYY-MM-DD');
        payloads.push({
          item_id: item.id,
          qty_delta: qtyDelta,
          note: data.note ? String(data.note) : null,
          adj_date: adjDate,
        });
      });

      if (payloads.length) {
        const insertMany = db.transaction((rowsToInsert) => {
          rowsToInsert.forEach((row) => {
            insert.run(
              row.item_id,
              row.qty_delta,
              null,
              row.note,
              row.adj_date,
              req.session.user.id,
              now
            );
          });
        });
        insertMany(payloads);
      }

      const message = `Import selesai. Berhasil: ${payloads.length}, Gagal: ${errors.length}.`;
      if (payloads.length > 0) {
        setFlash(req, 'success', errors.length ? `${message} Contoh error: ${errors.slice(0, 3).join(' | ')}` : message);
      } else {
        setFlash(req, 'error', errors.length ? errors.slice(0, 3).join(' | ') : 'Import gagal.');
      }
    } catch (importErr) {
      setFlash(req, 'error', 'Gagal membaca file Excel.');
    } finally {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    }

    return res.redirect('/adjustments');
  });
});

module.exports = router;
