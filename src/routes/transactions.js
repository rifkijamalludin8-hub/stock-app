const express = require('express');
const dayjs = require('dayjs');
const { requireCompany, requireAuth, canSeePrice } = require('../utils/auth');
const { setFlash } = require('../utils/flash');

const router = express.Router();

router.get('/transactions', requireCompany, requireAuth, (req, res) => {
  const db = req.db;
  const type = req.query.type === 'OUT' ? 'OUT' : 'IN';

  const items = db.prepare('SELECT id, name FROM items ORDER BY name ASC').all();
  const transactions = db
    .prepare(
      `SELECT t.*, i.name AS item_name
       FROM transactions t
       JOIN items i ON i.id = t.item_id
       WHERE t.type = ?
       ORDER BY t.txn_date DESC, t.id DESC
       LIMIT 50`
    )
    .all(type);

  res.render('pages/transactions', {
    type,
    items,
    transactions,
    today: dayjs().format('YYYY-MM-DD'),
    showPrice: canSeePrice(req),
  });
});

router.post('/transactions', requireCompany, requireAuth, (req, res) => {
  const db = req.db;
  const { type, item_id, qty, price_per_unit, note, txn_date } = req.body;
  if (!type || !item_id || !qty) {
    setFlash(req, 'error', 'Jenis, item, dan qty wajib diisi.');
    return res.redirect('/transactions');
  }

  const price = canSeePrice(req) ? Number(price_per_unit || 0) : null;
  try {
    db.prepare(
      `INSERT INTO transactions (item_id, type, qty, price_per_unit, note, txn_date, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      item_id,
      type,
      Number(qty),
      price,
      note || null,
      txn_date || dayjs().format('YYYY-MM-DD'),
      req.session.user.id,
      new Date().toISOString()
    );
    setFlash(req, 'success', 'Transaksi berhasil ditambahkan.');
  } catch (err) {
    setFlash(req, 'error', 'Gagal menambahkan transaksi.');
  }

  res.redirect(`/transactions?type=${type}`);
});

module.exports = router;
