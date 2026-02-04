const express = require('express');
const dayjs = require('dayjs');
const path = require('path');
const { requireCompany, requireAuth, canSeePrice } = require('../utils/auth');
const { divisionAccess, buildDivisionFilter } = require('../utils/division');
const { setFlash } = require('../utils/flash');
const { createProofUpload } = require('../utils/proof-upload');

const router = express.Router();
const upload = createProofUpload('txn');

router.get('/transactions', requireCompany, requireAuth, divisionAccess, (req, res) => {
  const db = req.db;
  const type = req.query.type === 'OUT' ? 'OUT' : 'IN';
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
  const transactions = db
    .prepare(
      `SELECT t.*,
              (g.name || ' - ' || i.name || ' - ' || COALESCE(i.expiry_date, '-')) AS item_label
       FROM transactions t
       JOIN items i ON i.id = t.item_id
       JOIN item_groups g ON g.id = i.group_id
       JOIN divisions d ON d.id = g.division_id
       WHERE t.type = ?
         ${filter.clause}
       ORDER BY t.txn_date DESC, t.id DESC
       LIMIT 50`
    )
    .all(type, ...filter.params);

  res.render('pages/transactions', {
    type,
    items,
    transactions,
    today: dayjs().format('YYYY-MM-DD'),
    showPrice: canSeePrice(req),
  });
});

router.post('/transactions', requireCompany, requireAuth, divisionAccess, (req, res) => {
  upload.single('proof')(req, res, (err) => {
    if (err) {
      setFlash(req, 'error', err.message || 'Upload bukti gagal.');
      return res.redirect(`/transactions?type=${req.body.type || 'IN'}`);
    }

    const db = req.db;
    const { type, item_id, qty, price_per_unit, note, txn_date } = req.body;
    if (!type || !item_id || !qty) {
      setFlash(req, 'error', 'Jenis, item, dan qty wajib diisi.');
      return res.redirect('/transactions');
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
        return res.redirect('/transactions');
      }
    }

    const price = canSeePrice(req) ? Number(price_per_unit || 0) : null;
    const proofPath = req.file ? path.join('uploads', 'proofs', req.file.filename) : null;
    try {
      db.prepare(
        `INSERT INTO transactions (item_id, type, qty, price_per_unit, proof_path, note, txn_date, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        item_id,
        type,
        Number(qty),
        price,
        proofPath,
        note || null,
        txn_date || dayjs().format('YYYY-MM-DD'),
        req.session.user.id,
        new Date().toISOString()
      );
      setFlash(req, 'success', 'Transaksi berhasil ditambahkan.');
    } catch (err) {
      setFlash(req, 'error', 'Gagal menambahkan transaksi.');
    }

    return res.redirect(`/transactions?type=${type}`);
  });
});

module.exports = router;
