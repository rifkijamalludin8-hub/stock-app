const express = require('express');
const dayjs = require('dayjs');
const path = require('path');
const { requireCompany, requireAuth, requireRole } = require('../utils/auth');
const { divisionAccess, buildDivisionFilter } = require('../utils/division');
const { setFlash } = require('../utils/flash');
const { createProofUpload } = require('../utils/proof-upload');

const router = express.Router();
const upload = createProofUpload('adj');

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
              (g.name || ' - ' || i.name || ' - ' || COALESCE(i.expiry_date, '-')) AS item_label
       FROM adjustments a
       JOIN items i ON i.id = a.item_id
       JOIN item_groups g ON g.id = i.group_id
       JOIN divisions d ON d.id = g.division_id
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

module.exports = router;
