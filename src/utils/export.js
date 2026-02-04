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
    .map((row) =>
      columns
        .map((col) => {
          const raw = row[col.key];
          const value = col.format ? col.format(raw) : raw;
          return toCsvValue(value);
        })
        .join(',')
    )
    .join('\n');
  const csv = header + '\n' + body;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  res.send(csv);
}

async function exportExcel(res, filename, columns, rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Data');
  sheet.columns = columns.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width || 20,
    style: col.numFmt ? { numFmt: col.numFmt } : undefined,
  }));
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

function exportPdf(res, filename, title, columns, rows, options = {}) {
  const margin = options.margin ?? 30;
  const doc = new PDFDocument({
    margin,
    size: options.size || 'A4',
    layout: options.layout || 'portrait',
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  doc.pipe(res);

  const titleFontSize = options.titleFontSize ?? 16;
  const headerFontSize = options.headerFontSize ?? 9;
  const bodyFontSize = options.bodyFontSize ?? 8;
  const rowGap = options.rowGap ?? 6;
  const headerGap = options.headerGap ?? 6;
  const colPadding = options.colPadding ?? 4;
  const metaFontSize = options.metaFontSize ?? 10;

  doc.fontSize(titleFontSize).text(title, { align: 'center' });
  doc.moveDown(0.8);

  if (Array.isArray(options.headerLines) && options.headerLines.length > 0) {
    doc.fontSize(metaFontSize).fillColor('#111');
    options.headerLines.forEach((line) => {
      doc.text(line, { align: 'left' });
    });
    doc.moveDown(0.6);
  }

  const availableWidth = doc.page.width - margin * 2;
  const rawWidths = columns.map((col) => col.pdfWidth || col.width || 100);
  const sumWidths = rawWidths.reduce((a, b) => a + b, 0) || 1;
  const scale = availableWidth / sumWidths;
  const columnWidths = rawWidths.map((w) => w * scale);
  const startX = doc.x;
  let y = doc.y;

  const positions = [];
  columnWidths.reduce((acc, w, idx) => {
    positions[idx] = acc;
    return acc + w;
  }, 0);

  function drawHeader() {
    doc.fontSize(headerFontSize).fillColor('#111');
    columns.forEach((col, idx) => {
      doc.text(col.header, startX + positions[idx] + colPadding, y, {
        width: columnWidths[idx] - colPadding * 2,
        align: 'left',
      });
    });
    const headerHeight = Math.max(
      ...columns.map((col, idx) =>
        doc.heightOfString(col.header, {
          width: columnWidths[idx] - colPadding * 2,
        })
      )
    );
    y += headerHeight + headerGap;
    doc.moveTo(startX, y).lineTo(startX + availableWidth, y).stroke();
    y += headerGap;
  }

  function ensurePage(rowHeight) {
    if (y + rowHeight > doc.page.height - margin) {
      doc.addPage();
      y = doc.y;
      drawHeader();
    }
  }

  drawHeader();

  rows.forEach((row) => {
    doc.fontSize(bodyFontSize).fillColor('#111');
    const rowHeight = Math.max(
      ...columns.map((col, idx) => {
        const raw = row[col.key];
        const value =
          raw === null || raw === undefined
            ? ''
            : String(col.format ? col.format(raw) : raw);
        return doc.heightOfString(value, {
          width: columnWidths[idx] - colPadding * 2,
        });
      })
    );
    ensurePage(rowHeight);
    columns.forEach((col, idx) => {
      const raw = row[col.key];
      const value =
        raw === null || raw === undefined
          ? ''
          : String(col.format ? col.format(raw) : raw);
      doc.text(value, startX + positions[idx] + colPadding, y, {
        width: columnWidths[idx] - colPadding * 2,
        align: 'left',
      });
    });
    y += rowHeight + rowGap;
  });

  doc.end();
}

module.exports = { exportCsv, exportExcel, exportPdf };
