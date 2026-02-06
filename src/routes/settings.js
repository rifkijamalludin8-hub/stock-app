const express = require('express');
const { requireCompany, requireAuth, requireRole } = require('../utils/auth');
const { setFlash } = require('../utils/flash');
const { getCompanyById } = require('../db/master');
const { runAutoBackup, buildDatabaseBackupWorkbook } = require('../utils/backup');
const { getReportRows } = require('../utils/report');
const { pool } = require('../db/pg');

const router = express.Router();

router.get('/settings', requireCompany, requireAuth, requireRole('user'), async (req, res) => {
  const company = await getCompanyById(req.company.id);
  res.render('pages/settings', { company });
});

router.get('/backup/company', requireCompany, requireAuth, requireRole('user'), async (req, res) => {
  try {
    const { workbook } = await buildDatabaseBackupWorkbook(req.company.id);
    const filename = `backup-${req.company.slug || req.company.id}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    setFlash(req, 'error', 'Gagal membuat backup Excel.');
    return res.redirect('/settings');
  }
});

router.post('/backup/test', requireCompany, requireAuth, requireRole('user'), async (req, res) => {
  const missing = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].filter((key) => !process.env[key]);
  if (missing.length) {
    setFlash(req, 'error', 'SMTP belum lengkap. Isi SMTP_HOST, SMTP_USER, SMTP_PASS di Render.');
    return res.redirect('/settings');
  }
  runAutoBackup().catch((err) => {
    console.error('Manual backup failed:', err);
  });
  setFlash(req, 'success', 'Backup sedang diproses. Cek email user utama dan Logs bila belum masuk.');
  return res.redirect('/settings');
});

router.post('/opening/rebuild', requireCompany, requireAuth, requireRole('user'), async (req, res) => {
  const { cutoff_date, confirm_text } = req.body;
  if (!cutoff_date) {
    setFlash(req, 'error', 'Tanggal cutoff wajib diisi.');
    return res.redirect('/settings');
  }
  if ((confirm_text || '').trim().toUpperCase() !== 'HAPUS') {
    setFlash(req, 'error', 'Ketik HAPUS untuk konfirmasi penghapusan data lama.');
    return res.redirect('/settings');
  }

  try {
    const rows = await getReportRows(req.db, req.company.id, cutoff_date, cutoff_date, null);
    const openingPayload = rows
      .map((row) => ({
        item_id: row.item_id,
        qty: Number(row.opening || 0),
        price_per_unit: row.price_per_unit ?? null,
      }))
      .filter((row) => row.qty !== 0);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DELETE FROM opening_balances WHERE company_id = $1 AND opening_date <= $2',
        [req.company.id, cutoff_date]
      );
      await client.query(
        'DELETE FROM transactions WHERE company_id = $1 AND txn_date < $2',
        [req.company.id, cutoff_date]
      );
      await client.query(
        'DELETE FROM adjustments WHERE company_id = $1 AND adj_date < $2',
        [req.company.id, cutoff_date]
      );

      if (openingPayload.length) {
        const values = [];
        const params = [];
        let idx = 1;
        openingPayload.forEach((row) => {
          values.push(
            `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`
          );
          params.push(
            req.company.id,
            row.item_id,
            row.qty,
            row.price_per_unit,
            'Rebuild saldo awal',
            cutoff_date,
            req.session.user.id
          );
        });
        await client.query(
          `INSERT INTO opening_balances (company_id, item_id, qty, price_per_unit, note, opening_date, created_by)
           VALUES ${values.join(', ')}`,
          params
        );
      }

      await client.query('COMMIT');
      setFlash(
        req,
        'success',
        `Rebuild selesai. Stock awal dihitung per ${cutoff_date} dan data lama dihapus.`
      );
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    setFlash(req, 'error', 'Gagal rebuild saldo awal. Cek Logs untuk detail.');
  }

  return res.redirect('/settings');
});

module.exports = router;
