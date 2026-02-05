const express = require('express');
const dayjs = require('dayjs');
const fs = require('fs');
const { requireCompany, requireAuth, requireRole, canSeePrice } = require('../utils/auth');
const { setFlash } = require('../utils/flash');
const { divisionAccess, buildDivisionFilter } = require('../utils/division');
const { createExcelUpload } = require('../utils/excel-upload');
const { parsePrice } = require('../utils/format');
const { readExcelRows, buildItemLookup, resolveItem, parseDate } = require('../utils/import-helpers');

const router = express.Router();
const upload = createExcelUpload('opening');

router.get('/opening', requireCompany, requireAuth, divisionAccess, async (req, res) => {
  const db = req.db;
  const companyId = req.company.id;
  const filterItems = buildDivisionFilter(req.divisionIds, 'd.id', 2);
  const filterEdit = buildDivisionFilter(req.divisionIds, 'd.id', 3);
  const editId = req.query.edit ? Number(req.query.edit) : null;
  const items = await db.query(
    `SELECT i.id, i.name, i.expiry_date, g.name AS group_name
     FROM items i
     JOIN item_groups g ON g.id = i.group_id
     JOIN divisions d ON d.id = g.division_id
     WHERE i.company_id = $1 ${filterItems.clause}
     ORDER BY g.name ASC, i.name ASC`,
    [companyId, ...filterItems.params]
  );

  let editOpening = null;
  if (editId && req.session.user && req.session.user.role === 'user') {
    const rows = await db.query(
      `SELECT ob.*, i.name AS item_name, i.expiry_date, g.name AS group_name
       FROM opening_balances ob
       JOIN items i ON i.id = ob.item_id
       JOIN item_groups g ON g.id = i.group_id
       JOIN divisions d ON d.id = g.division_id
       WHERE ob.id = $1 AND ob.company_id = $2
         ${filterEdit.clause}
       LIMIT 1`,
      [editId, companyId, ...filterEdit.params]
    );
    editOpening = rows[0] || null;
  }

  const openings = await db.query(
    `SELECT ob.*, i.name AS item_name, i.expiry_date, g.name AS group_name, d.name AS division_name
     FROM opening_balances ob
     JOIN items i ON i.id = ob.item_id
     JOIN item_groups g ON g.id = i.group_id
     JOIN divisions d ON d.id = g.division_id
     WHERE ob.company_id = $1 ${filterItems.clause}
     ORDER BY ob.opening_date DESC, ob.id DESC`,
    [companyId, ...filterItems.params]
  );

  res.render('pages/opening', {
    items,
    openings,
    today: dayjs().format('YYYY-MM-DD'),
    showPrice: canSeePrice(req),
    canCreate: req.session.user && req.session.user.role === 'user',
    editOpening,
  });
});

router.post('/opening', requireCompany, requireAuth, requireRole('user'), divisionAccess, async (req, res) => {
  const db = req.db;
  const companyId = req.company.id;
  const { item_id, qty, price_per_unit, note, opening_date } = req.body;
  if (!item_id || !qty || !opening_date) {
    setFlash(req, 'error', 'Item, tanggal, dan qty wajib diisi.');
    return res.redirect('/opening');
  }
  if (req.divisionIds) {
    const item = await db.query(
      `SELECT g.division_id
       FROM items i
       JOIN item_groups g ON g.id = i.group_id
       WHERE i.id = $1 AND i.company_id = $2`,
      [item_id, companyId]
    );
    const divisionId = item[0] ? Number(item[0].division_id) : null;
    if (!divisionId || !req.divisionIds.includes(divisionId)) {
      setFlash(req, 'error', 'Tidak punya akses ke divisi tersebut.');
      return res.redirect('/opening');
    }
  }

  let priceValue = null;
  if (price_per_unit !== undefined && price_per_unit !== null && String(price_per_unit).trim() !== '') {
    priceValue = parsePrice(price_per_unit);
    if (priceValue === null) {
      setFlash(req, 'error', 'Harga/Unit tidak valid.');
      return res.redirect('/opening');
    }
  }

  try {
    await db.query(
      `INSERT INTO opening_balances (company_id, item_id, qty, price_per_unit, note, opening_date, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        companyId,
        item_id,
        Number(qty),
        priceValue,
        note || null,
        opening_date,
        req.session.user.id,
        new Date().toISOString(),
      ]
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
    const companyId = req.company.id;
    const id = Number(req.params.id);
    const { item_id, qty, price_per_unit, note, opening_date } = req.body;
    if (!id || !item_id || !qty || !opening_date) {
      setFlash(req, 'error', 'Item, tanggal, dan qty wajib diisi.');
      return res.redirect('/opening');
    }
    if (req.divisionIds) {
      const item = await db.query(
        `SELECT g.division_id
         FROM items i
         JOIN item_groups g ON g.id = i.group_id
         WHERE i.id = $1 AND i.company_id = $2`,
        [item_id, companyId]
      );
      const divisionId = item[0] ? Number(item[0].division_id) : null;
      if (!divisionId || !req.divisionIds.includes(divisionId)) {
        setFlash(req, 'error', 'Tidak punya akses ke divisi tersebut.');
        return res.redirect('/opening');
      }
    }

    let priceValue = null;
    if (price_per_unit !== undefined && price_per_unit !== null && String(price_per_unit).trim() !== '') {
      priceValue = parsePrice(price_per_unit);
      if (priceValue === null) {
        setFlash(req, 'error', 'Harga/Unit tidak valid.');
        return res.redirect('/opening');
      }
    }

    try {
      await db.query(
        `UPDATE opening_balances
         SET item_id = $1, qty = $2, price_per_unit = $3, note = $4, opening_date = $5
         WHERE id = $6 AND company_id = $7`,
        [item_id, Number(qty), priceValue, note || null, opening_date, id, companyId]
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
    const companyId = req.company.id;
    const id = Number(req.params.id);
    if (!id) {
      setFlash(req, 'error', 'Data tidak ditemukan.');
      return res.redirect('/opening');
    }

    if (req.divisionIds) {
      const row = await db.query(
        `SELECT g.division_id
         FROM opening_balances ob
         JOIN items i ON i.id = ob.item_id
         JOIN item_groups g ON g.id = i.group_id
         WHERE ob.id = $1 AND ob.company_id = $2`,
        [id, companyId]
      );
      const divisionId = row[0] ? Number(row[0].division_id) : null;
      if (!divisionId || !req.divisionIds.includes(divisionId)) {
        setFlash(req, 'error', 'Tidak punya akses ke divisi tersebut.');
        return res.redirect('/opening');
      }
    }

    try {
      await db.query('DELETE FROM opening_balances WHERE id = $1 AND company_id = $2', [id, companyId]);
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
    const companyId = req.company.id;
    const filter = buildDivisionFilter(req.divisionIds, 'd.id', 2);
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

      const lookup = await buildItemLookup(db, companyId, req.divisionIds, filter.clause, filter.params);
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
          ? parsePrice(data.price_per_unit)
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
        const values = [];
        const params = [];
        let idx = 1;
        payloads.forEach((row) => {
          values.push(
            `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
          );
          params.push(
            companyId,
            row.item_id,
            row.qty,
            row.price_per_unit,
            row.note,
            row.opening_date,
            req.session.user.id,
            now
          );
        });
        await db.query(
          `INSERT INTO opening_balances (company_id, item_id, qty, price_per_unit, note, opening_date, created_by, created_at)
           VALUES ${values.join(', ')}`,
          params
        );
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
