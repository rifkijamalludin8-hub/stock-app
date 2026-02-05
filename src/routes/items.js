const express = require('express');
const fs = require('fs');
const { requireCompany, requireAuth } = require('../utils/auth');
const { setFlash } = require('../utils/flash');
const { getCurrentStockMap } = require('../utils/stock');
const { divisionAccess, buildDivisionFilter } = require('../utils/division');
const { createExcelUpload } = require('../utils/excel-upload');
const { readExcelRows, normalizeText, parseDate } = require('../utils/import-helpers');

const router = express.Router();
const excelUpload = createExcelUpload('items');

router.get('/items', requireCompany, requireAuth, divisionAccess, async (req, res) => {
  const db = req.db;
  const filter = buildDivisionFilter(req.divisionIds, 'd.id', 2);
  const editId = req.query.edit ? Number(req.query.edit) : null;
  const divisions = await db.query(
    'SELECT * FROM divisions WHERE company_id = $1 ORDER BY name ASC',
    [req.company.id]
  );
  const groups = await db.query(
    `SELECT g.*, d.name AS division_name
     FROM item_groups g
     JOIN divisions d ON d.id = g.division_id
     WHERE g.company_id = $1 ${filter.clause}
     ORDER BY d.name ASC, g.name ASC`,
    [req.company.id, ...filter.params]
  );
  const items = await db.query(
    `SELECT i.*, g.name AS group_name, g.id AS group_id, d.id AS division_id, d.name AS division_name
     FROM items i
     JOIN item_groups g ON g.id = i.group_id
     JOIN divisions d ON d.id = g.division_id
     WHERE i.company_id = $1 ${filter.clause}
     ORDER BY d.name ASC, g.name ASC, i.name ASC`,
    [req.company.id, ...filter.params]
  );

  const stockMap = await getCurrentStockMap(db, req.company.id, req.divisionIds);
  const itemsWithStock = items.map((item) => ({
    ...item,
    stock: stockMap.get(item.id) || 0,
  }));

  const allowedDivisions = req.divisionIds
    ? divisions.filter((div) => req.divisionIds.includes(div.id))
    : divisions;

  const divisionMap = new Map();
  itemsWithStock.forEach((item) => {
    if (!divisionMap.has(item.division_id)) {
      divisionMap.set(item.division_id, {
        id: item.division_id,
        name: item.division_name,
        groups: [],
        groupMap: new Map(),
      });
    }
    const division = divisionMap.get(item.division_id);
    if (!division.groupMap.has(item.group_id)) {
      const group = { id: item.group_id, name: item.group_name, items: [] };
      division.groupMap.set(item.group_id, group);
      division.groups.push(group);
    }
    division.groupMap.get(item.group_id).items.push(item);
  });

  const divisionsData = Array.from(divisionMap.values()).map((div) => {
    const clean = { id: div.id, name: div.name, groups: div.groups };
    return clean;
  });

  let editItem = null;
  if (editId) {
    const rows = await db.query(
      `SELECT i.*, g.id AS group_id, g.division_id
       FROM items i
       JOIN item_groups g ON g.id = i.group_id
       WHERE i.id = $1 AND i.company_id = $2`,
      [editId, req.company.id]
    );
    const item = rows[0];
    if (item && (!req.divisionIds || req.divisionIds.includes(item.division_id))) {
      editItem = item;
    }
  }

  res.render('pages/items', {
    divisions: divisionsData,
    groups,
    divisionsList: allowedDivisions,
    editItem,
  });
});

router.post('/items', requireCompany, requireAuth, divisionAccess, async (req, res) => {
  let { name, group_id, sku, unit, expiry_date, min_stock } = req.body;
  if (!name || !group_id) {
    setFlash(req, 'error', 'Nama item dan kelompok wajib diisi.');
    return res.redirect('/items');
  }
  if (req.divisionIds) {
    const rows = await req.db.query(
      'SELECT division_id FROM item_groups WHERE id = $1 AND company_id = $2',
      [group_id, req.company.id]
    );
    const group = rows[0];
    if (!group || !req.divisionIds.includes(group.division_id)) {
      setFlash(req, 'error', 'Tidak punya akses ke divisi tersebut.');
      return res.redirect('/items');
    }
  }
  try {
    if (!sku) {
      const skuRows = await req.db.query(
        "SELECT MAX(CAST(sku AS INTEGER)) AS maxSku FROM items WHERE company_id = $1 AND sku ~ '^[0-9]+$'",
        [req.company.id]
      );
      const nextSku = (skuRows[0]?.maxsku ? Number(skuRows[0].maxsku) : 0) + 1;
      sku = String(nextSku).padStart(4, '0');
    }
    await req.db.query(
      'INSERT INTO items (company_id, name, group_id, sku, unit, expiry_date, min_stock, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [
        req.company.id,
        name,
        group_id,
        sku || null,
        unit || null,
        expiry_date || null,
        min_stock || 0,
        new Date().toISOString(),
      ]
    );
    setFlash(req, 'success', 'Item berhasil ditambahkan.');
  } catch (err) {
    setFlash(req, 'error', 'Gagal menambahkan item.');
  }
  res.redirect('/items');
});

router.post('/items/:id/update', requireCompany, requireAuth, divisionAccess, async (req, res) => {
  const { id } = req.params;
  const { name, group_id, sku, unit, expiry_date, min_stock } = req.body;
  if (req.divisionIds) {
    const rows = await req.db.query(
      'SELECT division_id FROM item_groups WHERE id = $1 AND company_id = $2',
      [group_id, req.company.id]
    );
    const group = rows[0];
    if (!group || !req.divisionIds.includes(group.division_id)) {
      setFlash(req, 'error', 'Tidak punya akses ke divisi tersebut.');
      return res.redirect('/items');
    }
  }
  try {
    await req.db.query(
      'UPDATE items SET name = $1, group_id = $2, sku = $3, unit = $4, expiry_date = $5, min_stock = $6 WHERE id = $7 AND company_id = $8',
      [name, group_id, sku || null, unit || null, expiry_date || null, min_stock || 0, id, req.company.id]
    );
    setFlash(req, 'success', 'Item diperbarui.');
  } catch (err) {
    setFlash(req, 'error', 'Gagal memperbarui item.');
  }
  res.redirect('/items');
});

router.post('/items/:id/delete', requireCompany, requireAuth, divisionAccess, async (req, res) => {
  const { id } = req.params;
  const numericId = Number(id);
  if (req.divisionIds) {
    const rows = await req.db.query(
      `SELECT g.division_id
       FROM items i
       JOIN item_groups g ON g.id = i.group_id
       WHERE i.id = $1 AND i.company_id = $2`,
      [numericId, req.company.id]
    );
    const item = rows[0];
    if (!item || !req.divisionIds.includes(item.division_id)) {
      setFlash(req, 'error', 'Tidak punya akses ke divisi tersebut.');
      return res.redirect('/items');
    }
  }
  const stockMap = await getCurrentStockMap(req.db, req.company.id, req.divisionIds);
  const currentStock = stockMap.get(numericId) || 0;
  if (currentStock !== 0) {
    setFlash(req, 'error', 'Item tidak bisa dihapus karena masih ada stock. Hubungi user utama.');
    return res.redirect('/items');
  }
  const historyRows = await req.db.query(
    `SELECT
      (SELECT COUNT(*) FROM transactions WHERE item_id = $1 AND company_id = $2) +
      (SELECT COUNT(*) FROM adjustments WHERE item_id = $1 AND company_id = $2) +
      (SELECT COUNT(*) FROM opening_balances WHERE item_id = $1 AND company_id = $2) AS count`,
    [numericId, req.company.id]
  );
  const historyCount = Number(historyRows[0]?.count || 0);
  if (historyCount > 0) {
    setFlash(req, 'error', 'Item tidak bisa dihapus karena sudah ada riwayat transaksi. Hubungi user utama.');
    return res.redirect('/items');
  }
  try {
    await req.db.query('DELETE FROM items WHERE id = $1 AND company_id = $2', [
      numericId,
      req.company.id,
    ]);
    setFlash(req, 'success', 'Item dihapus.');
  } catch (err) {
    setFlash(req, 'error', 'Item tidak bisa dihapus karena ada transaksi.');
  }
  res.redirect('/items');
});

router.post('/items/import', requireCompany, requireAuth, divisionAccess, (req, res) => {
  excelUpload.single('file')(req, res, async (err) => {
    if (err) {
      setFlash(req, 'error', err.message || 'Upload gagal.');
      return res.redirect('/items');
    }
    if (!req.file) {
      setFlash(req, 'error', 'File Excel wajib diunggah.');
      return res.redirect('/items');
    }

    const db = req.db;
    const companyId = req.company.id;
    try {
      const { rows, headers } = await readExcelRows(req.file.path);
      if (rows.length === 0) {
        setFlash(req, 'error', 'File Excel kosong atau format tidak dikenali.');
        return res.redirect('/items');
      }

      const hasItem = headers.includes('item_name');
      const hasGroup = headers.includes('group_name') || headers.includes('group_id');
      if (!hasItem || !hasGroup) {
        setFlash(req, 'error', 'Kolom Nama Item dan Jenis Barang wajib ada.');
        return res.redirect('/items');
      }

      const groups = await db.query(
        `SELECT g.id, g.name, g.division_id, d.name AS division_name
         FROM item_groups g
         JOIN divisions d ON d.id = g.division_id
         WHERE g.company_id = $1`,
        [companyId]
      );
      const groupById = new Map(groups.map((g) => [Number(g.id), g]));
      const groupByName = new Map();
      const groupByComposite = new Map();
      groups.forEach((g) => {
        const key = normalizeText(g.name);
        if (!groupByName.has(key)) groupByName.set(key, []);
        groupByName.get(key).push(g);
        groupByComposite.set(`${normalizeText(g.division_name)}|${key}`, g);
      });

      const existingItems = await db.query(
        `SELECT id, name, group_id, expiry_date
         FROM items
         WHERE company_id = $1`,
        [companyId]
      );
      const existingMap = new Map();
      existingItems.forEach((row) => {
        const expiryKey = row.expiry_date ? String(row.expiry_date) : '';
        existingMap.set(`${row.group_id}|${normalizeText(row.name)}|${expiryKey}`, row);
      });

      const skuRows = await db.query(
        "SELECT MAX(CAST(sku AS INTEGER)) AS maxSku FROM items WHERE company_id = $1 AND sku ~ '^[0-9]+$'",
        [companyId]
      );
      let nextSku = (skuRows[0]?.maxsku ? Number(skuRows[0].maxsku) : 0) + 1;

      const payloads = [];
      const errors = [];
      let skipped = 0;
      const now = new Date().toISOString();

      rows.forEach(({ rowNumber, data }) => {
        const itemName = data.item_name ? String(data.item_name).trim() : '';
        if (!itemName) {
          errors.push(`Baris ${rowNumber}: Nama item kosong.`);
          return;
        }

        let group = null;
        if (data.group_id) {
          const parsed = Number(data.group_id);
          if (groupById.has(parsed)) group = groupById.get(parsed);
        }
        if (!group && data.group_name) {
          const groupNameKey = normalizeText(data.group_name);
          if (data.division_name) {
            const compositeKey = `${normalizeText(data.division_name)}|${groupNameKey}`;
            group = groupByComposite.get(compositeKey) || null;
          } else {
            const candidates = groupByName.get(groupNameKey) || [];
            if (candidates.length === 1) group = candidates[0];
          }
        }
        if (!group) {
          errors.push(`Baris ${rowNumber}: Jenis Barang/Divisi tidak ditemukan.`);
          return;
        }
        if (req.divisionIds && !req.divisionIds.includes(group.division_id)) {
          errors.push(`Baris ${rowNumber}: Tidak punya akses ke divisi ${group.division_name}.`);
          return;
        }

        const expiry = data.expiry_date ? parseDate(data.expiry_date) : null;
        if (data.expiry_date && !expiry) {
          errors.push(`Baris ${rowNumber}: Expired date tidak valid.`);
          return;
        }

        const key = `${group.id}|${normalizeText(itemName)}|${expiry || ''}`;
        if (existingMap.has(key)) {
          skipped += 1;
          return;
        }

        let sku = data.sku ? String(data.sku).trim() : '';
        if (!sku) {
          sku = String(nextSku).padStart(4, '0');
          nextSku += 1;
        }

        const minStockRaw = data.min_stock !== undefined && data.min_stock !== null ? data.min_stock : 0;
        const minStock = Number(minStockRaw);
        if (!Number.isFinite(minStock)) {
          errors.push(`Baris ${rowNumber}: Min Stock tidak valid.`);
          return;
        }

        payloads.push({
          name: itemName,
          group_id: group.id,
          sku,
          unit: data.unit ? String(data.unit).trim() : null,
          expiry_date: expiry,
          min_stock: minStock,
        });
      });

      if (payloads.length) {
        const values = [];
        const params = [];
        let idx = 1;
        payloads.forEach((row) => {
          values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
          params.push(
            companyId,
            row.name,
            row.group_id,
            row.sku,
            row.unit,
            row.expiry_date,
            row.min_stock,
            now
          );
        });
        await db.query(
          `INSERT INTO items (company_id, name, group_id, sku, unit, expiry_date, min_stock, created_at)
           VALUES ${values.join(', ')}`,
          params
        );
      }

      const message = `Import selesai. Berhasil: ${payloads.length}, Lewat: ${skipped}, Gagal: ${errors.length}.`;
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

    return res.redirect('/items');
  });
});

module.exports = router;
