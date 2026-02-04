const express = require('express');
const dayjs = require('dayjs');
const fs = require('fs');
const { requireCompany, requireAuth, requireRole, canSeePrice } = require('../utils/auth');
const { setFlash } = require('../utils/flash');
const { divisionAccess, buildDivisionFilter } = require('../utils/division');
const { createExcelUpload } = require('../utils/excel-upload');
const { readExcelRows, buildItemLookup, resolveItem, parseDate } = require('../utils/import-helpers');

const router = express.Router();
const upload = createExcelUpload('opening');

router.get('/opening', requireCompany, requireAuth, divisionAccess, (req, res) => {
  const db = req.db;
  const filter = buildDivisionFilter(req.divisionIds, 'd.id');
  const editId = req.query.edit ? Number(req.query.edit) : null;
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

  let editOpening = null;
  if (editId && req.session.user && req.session.user.role === 'user') {
    editOpening = db
      .prepare(
        `SELECT ob.*, i.name AS item_name, i.expiry_date, g.name AS group_name
         FROM opening_balances ob
         JOIN items i ON i.id = ob.item_id
         JOIN item_groups g ON g.id = i.group_id
         JOIN divisions d ON d.id = g.division_id
         WHERE ob.id = ?
           ${filter.clause}
         LIMIT 1`
      )
      .get(editId, ...filter.params);
  }

  const openings = db
    .prepare(
      `SELECT ob.*, i.name AS item_name, i.expiry_date, g.name AS group_name, d.name AS division_name
       FROM opening_balances ob
       JOIN items i ON i.id = ob.item_id
       JOIN item_groups g ON g.id = i.group_id
       JOIN divisions d ON d.id = g.division_id
       WHERE 1=1 ${filter.clause}
       ORDER BY ob.opening_date DESC, ob.id DESC`
    )
    .all(...filter.params);

  res.render('pages/opening', {
    items,
    openings,
    today: dayjs().format('YYYY-MM-DD'),
    showPrice: canSeePrice(req),
    canCreate: req.session.user && req.session.user.role === 'user',
    editOpening,
  });
});

router.post('/opening', requireCompany, requireAuth, requireRole('user'), divisionAccess, (req, res) => {
  const db = req.db;
  const { item_id, qty, price_per_unit, note, opening_date } = req.body;
  if (!item_id || !qty || !opening_date) {
    setFlash(req, 'error', 'Item, tanggal, dan qty wajib diisi.');
    return res.redirect('/opening');
  }
  if (req.divisionIds) {
    const item = db
      .prepare(
        `SELECT g.division_id
         FROM items i
         JOIN item_groups g ON g.id = i.group_id
         WHERE i.id = ?`
      )
      .get(item_id);
    if (!item || !req.divisionIds.includes(item.division_id)) {
      setFlash(req, 'error', 'Tidak punya akses ke divisi tersebut.');
      return res.redirect('/opening');
    }
  }

  try {
    db.prepare(
      `INSERT INTO opening_balances (item_id, qty, price_per_unit, note, opening_date, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      item_id,
      Number(qty),
      price_per_unit ? Number(price_per_unit) : null,
      note || null,
      opening_date,
      req.session.user.id,
      new Date().toISOString()
    );
    setFlash(req, 'success', 'Stock awal berhasil ditambahkan.');
  } catch (err) {
    setFlash(req, 'error', 'Gagal menambahkan stock awal.');
  }

  res.redirect('/opening');
});

router.post(
  '/opening/:id/update',
  requireCompany,
  requireAuth,
  requireRole('user'),
  divisionAccess,
  (req, res) => {
    const db = req.db;
    const id = Number(req.params.id);
    const { item_id, qty, price_per_unit, note, opening_date } = req.body;
    if (!id || !item_id || !qty || !opening_date) {
      setFlash(req, 'error', 'Item, tanggal, dan qty wajib diisi.');
      return res.redirect('/opening');
    }
    if (req.divisionIds) {
      const item = db
        .prepare(
          `SELECT g.division_id
           FROM items i
           JOIN item_groups g ON g.id = i.group_id
           WHERE i.id = ?`
        )
        .get(item_id);
      if (!item || !req.divisionIds.includes(item.division_id)) {
        setFlash(req, 'error', 'Tidak punya akses ke divisi tersebut.');
        return res.redirect('/opening');
      }
    }

    try {
      db.prepare(
        `UPDATE opening_balances
         SET item_id = ?, qty = ?, price_per_unit = ?, note = ?, opening_date = ?
         WHERE id = ?`
      ).run(
        item_id,
        Number(qty),
        price_per_unit ? Number(price_per_unit) : null,
        note || null,
        opening_date,
        id
      );
      setFlash(req, 'success', 'Stock awal berhasil diperbarui.');
    } catch (err) {
      setFlash(req, 'error', 'Gagal memperbarui stock awal.');
    }

    return res.redirect('/opening');
  }
);

router.post(
  '/opening/:id/delete',
  requireCompany,
  requireAuth,
  requireRole('user'),
  divisionAccess,
  (req, res) => {
    const db = req.db;
    const id = Number(req.params.id);
    if (!id) {
      setFlash(req, 'error', 'Data tidak ditemukan.');
      return res.redirect('/opening');
    }

    if (req.divisionIds) {
      const row = db
        .prepare(
          `SELECT g.division_id
           FROM opening_balances ob
           JOIN items i ON i.id = ob.item_id
           JOIN item_groups g ON g.id = i.group_id
           WHERE ob.id = ?`
        )
        .get(id);
      if (!row || !req.divisionIds.includes(row.division_id)) {
        setFlash(req, 'error', 'Tidak punya akses ke divisi tersebut.');
        return res.redirect('/opening');
      }
    }

    try {
      db.prepare('DELETE FROM opening_balances WHERE id = ?').run(id);
      setFlash(req, 'success', 'Stock awal berhasil dihapus.');
    } catch (err) {
      setFlash(req, 'error', 'Gagal menghapus stock awal.');
    }

    return res.redirect('/opening');
  }
);

router.post('/opening/import', requireCompany, requireAuth, requireRole('user'), divisionAccess, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      setFlash(req, 'error', err.message || 'Upload gagal.');
      return res.redirect('/opening');
    }
    if (!req.file) {
      setFlash(req, 'error', 'File Excel wajib diunggah.');
      return res.redirect('/opening');
    }

    const db = req.db;
    const filter = buildDivisionFilter(req.divisionIds, 'd.id');
    try {
      const { rows, headers } = await readExcelRows(req.file.path);
      if (rows.length === 0) {
        setFlash(req, 'error', 'File Excel kosong atau format tidak dikenali.');
        return res.redirect('/opening');
      }
      const hasItemHeader = headers.includes('item_id') || headers.includes('item_label') || headers.includes('item_name');
      if (!hasItemHeader) {
        setFlash(req, 'error', 'Kolom item tidak ditemukan. Gunakan Item atau Nama Item/Jenis Barang.');
        return res.redirect('/opening');
      }
      if (!headers.includes('qty')) {
        setFlash(req, 'error', 'Kolom Qty wajib ada.');
        return res.redirect('/opening');
      }
      if (!headers.includes('date')) {
        setFlash(req, 'error', 'Kolom Tanggal wajib ada.');
        return res.redirect('/opening');
      }

      const lookup = buildItemLookup(db, req.divisionIds, filter.clause, filter.params);
      const insert = db.prepare(
        `INSERT INTO opening_balances (item_id, qty, price_per_unit, note, opening_date, created_by, created_at)
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

        const qty = Number(data.qty);
        if (!Number.isFinite(qty)) {
          errors.push(`Baris ${rowNumber}: Qty tidak valid`);
          return;
        }

        const openingDate = parseDate(data.date);
        if (!openingDate) {
          errors.push(`Baris ${rowNumber}: Tanggal tidak valid`);
          return;
        }

        const price = data.price_per_unit !== undefined && data.price_per_unit !== null && data.price_per_unit !== ''
          ? Number(data.price_per_unit)
          : null;
        if (price !== null && !Number.isFinite(price)) {
          errors.push(`Baris ${rowNumber}: Harga tidak valid`);
          return;
        }

        payloads.push({
          item_id: item.id,
          qty,
          price_per_unit: price,
          note: data.note ? String(data.note) : null,
          opening_date: openingDate,
        });
      });

      if (payloads.length) {
        const insertMany = db.transaction((rowsToInsert) => {
          rowsToInsert.forEach((row) => {
            insert.run(
              row.item_id,
              row.qty,
              row.price_per_unit,
              row.note,
              row.opening_date,
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

    return res.redirect('/opening');
  });
});

module.exports = router;
