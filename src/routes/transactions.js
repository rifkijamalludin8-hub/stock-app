const express = require('express');
const dayjs = require('dayjs');
const path = require('path');
const { requireCompany, requireAuth, canSeePrice } = require('../utils/auth');
const { divisionAccess, buildDivisionFilter } = require('../utils/division');
const { setFlash } = require('../utils/flash');
const { createProofUpload } = require('../utils/proof-upload');
const { parsePrice } = require('../utils/format');

const router = express.Router();
const upload = createProofUpload('txn');

router.get('/transactions', requireCompany, requireAuth, divisionAccess, async (req, res) => {
  const db = req.db;
  const companyId = req.company.id;
  const type = req.query.type === 'OUT' ? 'OUT' : 'IN';
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
            (g.name || ' - ' || i.name || ' - ' || COALESCE(i.expiry_date, '-')) AS item_label,
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

  res.render('pages/transactions', {
    type,
    items,
    transactions,
    today: dayjs().format('YYYY-MM-DD'),
    showPrice: canSeePrice(req),
  });
});

router.post('/transactions', requireCompany, requireAuth, divisionAccess, (req, res) => {
  upload.single('proof')(req, res, async (err) => {
    if (err) {
      setFlash(req, 'error', err.message || 'Upload bukti gagal.');
      return res.redirect(`/transactions?type=${req.body.type || 'IN'}`);
    }

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
    const proofPath = req.file ? path.join('uploads', 'proofs', req.file.filename) : null;
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
          proofPath,
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
});

module.exports = router;
