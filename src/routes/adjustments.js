const express = require('express');
const dayjs = require('dayjs');
const { requireCompany, requireAuth, requireRole } = require('../utils/auth');
const { setFlash } = require('../utils/flash');

const router = express.Router();

router.get('/adjustments', requireCompany, requireAuth, requireRole('user'), (req, res) => {
  const db = req.db;
  const items = db.prepare('SELECT id, name FROM items ORDER BY name ASC').all();
  const adjustments = db
    .prepare(
      `SELECT a.*, i.name AS item_name
       FROM adjustments a
       JOIN items i ON i.id = a.item_id
       ORDER BY a.adj_date DESC, a.id DESC
       LIMIT 50`
    )
    .all();
  res.render('pages/adjustments', {
    items,
    adjustments,
    today: dayjs().format('YYYY-MM-DD'),
  });
});

router.post('/adjustments', requireCompany, requireAuth, requireRole('user'), (req, res) => {
  const db = req.db;
  const { item_id, qty_delta, note, adj_date } = req.body;
  if (!item_id || !qty_delta) {
    setFlash(req, 'error', 'Item dan jumlah adjustment wajib diisi.');
    return res.redirect('/adjustments');
  }
  try {
    db.prepare(
      `INSERT INTO adjustments (item_id, qty_delta, note, adj_date, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      item_id,
      Number(qty_delta),
      note || null,
      adj_date || dayjs().format('YYYY-MM-DD'),
      req.session.user.id,
      new Date().toISOString()
    );
    setFlash(req, 'success', 'Adjustment berhasil ditambahkan.');
  } catch (err) {
    setFlash(req, 'error', 'Gagal menambahkan adjustment.');
  }

  res.redirect('/adjustments');
});

module.exports = router;
