const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { dataDir } = require('../db/master');

const importDir = path.join(dataDir, 'uploads', 'imports');
if (!fs.existsSync(importDir)) fs.mkdirSync(importDir, { recursive: true });

function createExcelUpload(prefix) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, importDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.xlsx';
      const safeExt = ext === '.xlsx' ? ext : '.xlsx';
      const companyId = req.company ? req.company.id : 'company';
      cb(null, `${prefix}-${companyId}-${Date.now()}${safeExt}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext !== '.xlsx') {
        return cb(new Error('File harus .xlsx'));
      }
      cb(null, true);
    },
  });
}

module.exports = { createExcelUpload };
