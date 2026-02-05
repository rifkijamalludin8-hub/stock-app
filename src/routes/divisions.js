const express = require('express');
const { requireCompany, requireAuth, requireRole } = require('../utils/auth');
const { setFlash } = require('../utils/flash');

const router = express.Router();

router.get('/divisions', requireCompany, requireAuth, requireRole('user'), async (req, res) => {
  const divisions = await req.db.query(
    'SELECT * FROM divisions WHERE company_id = $1 ORDER BY name ASC',
    [req.company.id]
  );
  res.render('pages/divisions', { divisions });
});

router.post('/divisions', requireCompany, requireAuth, requireRole('user'), async (req, res) => {
  const { name, description } = req.body;
  if (!name) {
    setFlash(req, 'error', 'Nama divisi wajib diisi.');
    return res.redirect('/divisions');
  }
  try {
    await req.db.query(
      'INSERT INTO divisions (company_id, name, description) VALUES ($1, $2, $3)',
      [req.company.id, name, description || null]
    );
    setFlash(req, 'success', 'Divisi berhasil ditambahkan.');
  } catch (err) {
    setFlash(req, 'error', 'Divisi gagal ditambahkan (nama mungkin sudah ada).');
  }
  res.redirect('/divisions');
});

router.post('/divisions/:id/delete', requireCompany, requireAuth, requireRole('user'), async (req, res) => {
  const { id } = req.params;
  try {
    await req.db.query('DELETE FROM divisions WHERE id = $1 AND company_id = $2', [
      id,
      req.company.id,
    ]);
    setFlash(req, 'success', 'Divisi dihapus.');
  } catch (err) {
    setFlash(req, 'error', 'Divisi tidak bisa dihapus karena masih dipakai.');
  }
  res.redirect('/divisions');
});

module.exports = router;
