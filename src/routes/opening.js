const express = require('express');
const dayjs = require('dayjs');
const { requireCompany, requireAuth, requireRole, canSeePrice } = require('../utils/auth');
const { setFlash } = require('../utils/flash');
const { divisionAccess, buildDivisionFilter } = require('../utils/division');

const router = express.Router();

router.get('/opening', requireCompany, requireAuth, divisionAccess, (req, res) => {
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

module.exports = router;
