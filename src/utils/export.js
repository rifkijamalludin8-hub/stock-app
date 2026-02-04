const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

function toCsvValue(value) {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return '"' + stringValue.replace(/"/g, '""') + '"';
  }
  return stringValue;
}

function exportCsv(res, filename, columns, rows) {
  const header = columns.map((col) => toCsvValue(col.header)).join(',');
  const body = rows
    .map((row) => columns.map((col) => toCsvValue(row[col.key])).join(','))
    .join('\n');
  const csv = header + '\n' + body;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  res.send(csv);
}

async function exportExcel(res, filename, columns, rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Data');
  sheet.columns = columns.map((col) => ({ header: col.header, key: col.key, width: col.width || 20 }));
  rows.forEach((row) => sheet.addRow(row));
  sheet.getRow(1).font = { bold: true };
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

function exportPdf(res, filename, title, columns, rows) {
  const doc = new PDFDocument({ margin: 30, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  doc.pipe(res);

  doc.fontSize(16).text(title, { align: 'center' });
  doc.moveDown(1);

  const columnWidths = columns.map((col) => col.width || 100);
  const startX = doc.x;
  let y = doc.y;

  doc.fontSize(10).fillColor('#111');

  columns.forEach((col, idx) => {
    doc.text(col.header, startX + columnWidths.slice(0, idx).reduce((a, b) => a + b, 0), y, {
      width: columnWidths[idx],
      align: 'left',
    });
  });

  y += 18;
  doc.moveTo(startX, y).lineTo(startX + columnWidths.reduce((a, b) => a + b, 0), y).stroke();
  y += 6;

  rows.forEach((row) => {
    columns.forEach((col, idx) => {
      const value = row[col.key] === null || row[col.key] === undefined ? '' : String(row[col.key]);
      doc.text(value, startX + columnWidths.slice(0, idx).reduce((a, b) => a + b, 0), y, {
        width: columnWidths[idx],
        align: 'left',
      });
    });
    y += 16;
    if (y > doc.page.height - 60) {
      doc.addPage();
      y = doc.y;
    }
  });

  doc.end();
}

module.exports = { exportCsv, exportExcel, exportPdf };
