const express = require('express');
const dayjs = require('dayjs');
const { requireCompany, requireAuth, requireRole, canSeePrice } = require('../utils/auth');
const { divisionAccess, buildDivisionFilter } = require('../utils/division');
const { setFlash } = require('../utils/flash');
const { parsePrice } = require('../utils/format');

const router = express.Router();

router.get('/transactions', requireCompany, requireAuth, divisionAccess, async (req, res) => {
  const db = req.db;
  const companyId = req.company.id;
  const type = req.query.type === 'OUT' ? 'OUT' : 'IN';
  const editId = req.query.edit ? Number(req.query.edit) : null;
  const filter = buildDivisionFilter(req.divisionIds, 'd.id', 2);
  const filterTx = buildDivisionFilter(req.divisionIds, 'd.id', 3);

  const items = await db.query(
    `SELECT i.id, i.name, i.expiry_date, g.name AS group_name
     FROM items i
     JOIN item_groups g ON g.id = i.group_id
     JOIN divisions d ON d.id = g.division_id
     WHERE i.company_id = $1 ${filter.clause}
     ORDER BY g.name ASC, i.name ASC`,
    [companyId, ...filter.params]
  );
  const transactions = await db.query(
    `SELECT t.*,
            (g.name || ' - ' || i.name || ' - ' || COALESCE(i.expiry_date::text, '-')) AS item_label,
            u.name AS created_by_name
     FROM transactions t
     JOIN items i ON i.id = t.item_id
     JOIN item_groups g ON g.id = i.group_id
     JOIN divisions d ON d.id = g.division_id
     LEFT JOIN users u ON u.id = t.created_by
     WHERE t.company_id = $1
       AND t.type = $2
       ${filterTx.clause}
     ORDER BY t.txn_date DESC, t.id DESC
     LIMIT 50`,
    [companyId, type, ...filterTx.params]
  );

  let editTx = null;
  if (editId && req.session.user && req.session.user.role === 'user') {
    const rows = await db.query(
      `SELECT t.*, i.name AS item_name, i.expiry_date, g.name AS group_name, g.id AS group_id, d.id AS division_id
       FROM transactions t
       JOIN items i ON i.id = t.item_id
       JOIN item_groups g ON g.id = i.group_id
       JOIN divisions d ON d.id = g.division_id
       WHERE t.id = $1 AND t.company_id = $2 AND t.type = $3
         ${filterTx.clause}
       LIMIT 1`,
      [editId, companyId, type, ...filterTx.params]
    );
    editTx = rows[0] || null;
  }

  res.render('pages/transactions', {
    type,
    items,
    transactions,
    today: dayjs().format('YYYY-MM-DD'),
    showPrice: canSeePrice(req),
    editTx,
  });
});

router.post('/transactions', requireCompany, requireAuth, divisionAccess, async (req, res) => {
  const db = req.db;
  const companyId = req.company.id;
  const { type, item_id, qty, price_per_unit, note, txn_date } = req.body;
  if (!type || !item_id || !qty) {
    setFlash(req, 'error', 'Jenis, item, dan qty wajib diisi.');
    return res.redirect('/transactions');
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
      return res.redirect('/transactions');
    }
  }

  let price = null;
  if (canSeePrice(req)) {
    if (price_per_unit !== undefined && price_per_unit !== null && String(price_per_unit).trim() !== '') {
      price = parsePrice(price_per_unit);
      if (price === null) {
        setFlash(req, 'error', 'Harga/Unit tidak valid.');
        return res.redirect(`/transactions?type=${type}`);
      }
    }
  }
  try {
    await db.query(
      `INSERT INTO transactions (company_id, item_id, type, qty, price_per_unit, proof_path, note, txn_date, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        companyId,
        item_id,
        type,
        Number(qty),
        price,
        null,
        note || null,
        txn_date || dayjs().format('YYYY-MM-DD'),
        req.session.user.id,
        new Date().toISOString(),
      ]
    );
    setFlash(req, 'success', 'Transaksi berhasil ditambahkan.');
  } catch (err) {
    setFlash(req, 'error', 'Gagal menambahkan transaksi.');
  }

  return res.redirect(`/transactions?type=${type}`);
});

router.post(
  '/transactions/:id/update',
  requireCompany,
  requireAuth,
  requireRole('user'),
  divisionAccess,
  async (req, res) => {
    const db = req.db;
    const companyId = req.company.id;
    const id = Number(req.params.id);
    const { type, item_id, qty, price_per_unit, note, txn_date } = req.body;
    if (!id || !type || !item_id || !qty || !txn_date) {
      setFlash(req, 'error', 'Tanggal, item, dan qty wajib diisi.');
      return res.redirect(`/transactions?type=${type || 'IN'}`);
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
        return res.redirect(`/transactions?type=${type}`);
      }
    }

    let price = null;
    if (canSeePrice(req) && type === 'IN') {
      if (price_per_unit !== undefined && price_per_unit !== null && String(price_per_unit).trim() !== '') {
        price = parsePrice(price_per_unit);
        if (price === null) {
          setFlash(req, 'error', 'Harga/Unit tidak valid.');
          return res.redirect(`/transactions?type=${type}&edit=${id}`);
        }
      }
    }

    try {
      const result = await db.query(
        `UPDATE transactions
         SET item_id = $1, qty = $2, price_per_unit = $3, note = $4, txn_date = $5
         WHERE id = $6 AND company_id = $7 AND type = $8`,
        [item_id, Number(qty), price, note || null, txn_date, id, companyId, type]
      );
      if (result.rowCount === 0) {
        setFlash(req, 'error', 'Transaksi tidak ditemukan.');
      } else {
        setFlash(req, 'success', 'Transaksi berhasil diperbarui.');
      }
    } catch (err) {
      setFlash(req, 'error', 'Gagal memperbarui transaksi.');
    }
    return res.redirect(`/transactions?type=${type}`);
  }
);

router.post(
  '/transactions/:id/delete',
  requireCompany,
  requireAuth,
  requireRole('user'),
  divisionAccess,
  async (req, res) => {
    const db = req.db;
    const companyId = req.company.id;
    const id = Number(req.params.id);
    const type = req.body.type === 'OUT' ? 'OUT' : 'IN';
    if (!id) {
      setFlash(req, 'error', 'Transaksi tidak ditemukan.');
      return res.redirect(`/transactions?type=${type}`);
    }
    if (req.divisionIds) {
      const row = await db.query(
        `SELECT g.division_id
         FROM transactions t
         JOIN items i ON i.id = t.item_id
         JOIN item_groups g ON g.id = i.group_id
         WHERE t.id = $1 AND t.company_id = $2`,
        [id, companyId]
      );
      const divisionId = row[0] ? Number(row[0].division_id) : null;
      if (!divisionId || !req.divisionIds.includes(divisionId)) {
        setFlash(req, 'error', 'Tidak punya akses ke divisi tersebut.');
        return res.redirect(`/transactions?type=${type}`);
      }
    }
    try {
      await db.query('DELETE FROM transactions WHERE id = $1 AND company_id = $2', [id, companyId]);
      setFlash(req, 'success', 'Transaksi berhasil dihapus.');
    } catch (err) {
      setFlash(req, 'error', 'Gagal menghapus transaksi.');
    }
    return res.redirect(`/transactions?type=${type}`);
  }
);

router.post(
  '/transactions/delete-selected',
  requireCompany,
  requireAuth,
  requireRole('user'),
  divisionAccess,
  async (req, res) => {
    const db = req.db;
    const companyId = req.company.id;
    const type = req.body.type === 'OUT' ? 'OUT' : 'IN';
    const rawIds = req.body.ids;
    const ids = Array.isArray(rawIds) ? rawIds : rawIds ? [rawIds] : [];
    const idNumbers = ids.map((id) => Number(id)).filter((id) => Number.isFinite(id));
    if (idNumbers.length === 0) {
      setFlash(req, 'error', 'Pilih transaksi yang akan dihapus.');
      return res.redirect(`/transactions?type=${type}`);
    }

    const filter = buildDivisionFilter(req.divisionIds, 'd.id', 4);
    const allowedRows = await db.query(
      `SELECT t.id
       FROM transactions t
       JOIN items i ON i.id = t.item_id
       JOIN item_groups g ON g.id = i.group_id
       JOIN divisions d ON d.id = g.division_id
       WHERE t.company_id = $1
         AND t.type = $2
         AND t.id = ANY($3)
         ${filter.clause}`,
      [companyId, type, idNumbers, ...filter.params]
    );
    const allowedIds = allowedRows.map((row) => Number(row.id));
    if (allowedIds.length === 0) {
      setFlash(req, 'error', 'Transaksi tidak ditemukan atau tidak punya akses.');
      return res.redirect(`/transactions?type=${type}`);
    }

    try {
      await db.query('DELETE FROM transactions WHERE company_id = $1 AND type = $2 AND id = ANY($3)', [
        companyId,
        type,
        allowedIds,
      ]);
      setFlash(req, 'success', `Berhasil hapus ${allowedIds.length} transaksi.`);
    } catch (err) {
      setFlash(req, 'error', 'Gagal menghapus transaksi terpilih.');
    }
    return res.redirect(`/transactions?type=${type}`);
  }
);

router.post(
  '/transactions/delete-all',
  requireCompany,
  requireAuth,
  requireRole('user'),
  divisionAccess,
  async (req, res) => {
    const db = req.db;
    const companyId = req.company.id;
    const type = req.body.type === 'OUT' ? 'OUT' : 'IN';
    const confirmText = (req.body.confirm_text || '').trim();
    if (confirmText !== 'HAPUS SEMUA TRANSAKSI') {
      setFlash(req, 'error', 'Konfirmasi tidak sesuai. Ketik: HAPUS SEMUA TRANSAKSI.');
      return res.redirect(`/transactions?type=${type}`);
    }

    const filter = buildDivisionFilter(req.divisionIds, 'd.id', 3);
    try {
      const result = await db.query(
        `DELETE FROM transactions t
         USING items i, item_groups g, divisions d
         WHERE t.company_id = $1
           AND t.type = $2
           AND t.item_id = i.id
           AND g.id = i.group_id
           AND d.id = g.division_id
           ${filter.clause}`,
        [companyId, type, ...filter.params]
      );
      const count = Number(result?.rowCount || 0);
      setFlash(req, 'success', `Berhasil hapus ${count} transaksi ${type}.`);
    } catch (err) {
      setFlash(req, 'error', 'Gagal menghapus semua transaksi.');
    }
    return res.redirect(`/transactions?type=${type}`);
  }
);

module.exports = router;
