const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const dayjs = require('dayjs');

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

function formatMutationExportDate(value) {
  if (!value) return '-';
  const parsed = dayjs(value);
  if (!parsed.isValid()) return String(value);
  return parsed.format('DD/MM/YY');
}

function formatMutationQty(value) {
  const numberValue = Number(value || 0);
  if (!Number.isFinite(numberValue)) return '';
  return new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(numberValue);
}

function normalizeMutationRows(groupedRows) {
  const sections = [];
  const divisionMap = new Map();

  groupedRows.forEach(({ item, rows }) => {
    const divisionName = item.division_name || '-';
    if (!divisionMap.has(divisionName)) {
      const section = { divisionName, items: [] };
      divisionMap.set(divisionName, section);
      sections.push(section);
    }

    const normalizedRows = rows.map((row) => {
      const type = String(row.type || '').toUpperCase();
      const isOpening = type === 'SALDO AWAL';
      const isIn = type === 'IN';
      const isOut = type === 'OUT';
      const isAdj = type === 'ADJ' || type === 'OPENING';
      const note = isOpening
        ? 'SALDO AWAL'
        : row.note || (type === 'OPENING' ? 'STOCK AWAL' : type);

      return {
        date: formatMutationExportDate(row.event_date),
        note,
        inQty: isIn ? Number(row.qty || 0) : null,
        outQty: isOut ? Number(row.qty || 0) : null,
        adjQty: isAdj ? Number(row.qty || 0) : null,
        saldo: Number(row.saldo || 0),
        unit: item.unit || '',
        createdBy: row.created_by_name || '-',
        createdAt: row.created_at ? formatMutationExportDate(row.created_at) : '-',
      };
    });

    const totals = normalizedRows.reduce(
      (acc, row) => {
        acc.inQty += Number(row.inQty || 0);
        acc.outQty += Number(row.outQty || 0);
        acc.adjQty += Number(row.adjQty || 0);
        acc.saldo = Number(row.saldo || acc.saldo || 0);
        return acc;
      },
      { inQty: 0, outQty: 0, adjQty: 0, saldo: Number(item.opening || 0) }
    );

    divisionMap.get(divisionName).items.push({
      itemName: item.item_name || '-',
      expiryDate: formatMutationExportDate(item.expiry_date),
      groupName: item.group_name || '-',
      rows: normalizedRows,
      totals,
    });
  });

  return sections;
}

async function exportMutationExcel(res, filename, companyName, startDate, endDate, groupedRows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Mutasi');
  const columns = [
    { key: 'date', width: 12 },
    { key: 'note', width: 26 },
    { key: 'inQty', width: 7 },
    { key: 'outQty', width: 7 },
    { key: 'adjQty', width: 7 },
    { key: 'saldo', width: 8 },
    { key: 'unit', width: 8 },
    { key: 'createdBy', width: 10 },
    { key: 'createdAt', width: 12 },
  ];
  sheet.columns = columns;
  sheet.pageSetup = {
    orientation: 'portrait',
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
  };
  sheet.views = [{ showGridLines: true }];

  const sections = normalizeMutationRows(groupedRows);

  let rowIndex = 1;
  const lastCol = 'I';
  sheet.mergeCells(`A${rowIndex}:${lastCol}${rowIndex}`);
  sheet.getCell(`A${rowIndex}`).value = String(companyName || '-').toUpperCase();
  sheet.getCell(`A${rowIndex}`).font = { bold: true, size: 14 };
  sheet.getCell(`A${rowIndex}`).alignment = { horizontal: 'center' };
  rowIndex += 1;
  sheet.mergeCells(`A${rowIndex}:${lastCol}${rowIndex}`);
  sheet.getCell(`A${rowIndex}`).value = 'MUTASI BARANG';
  sheet.getCell(`A${rowIndex}`).font = { bold: true, size: 12 };
  sheet.getCell(`A${rowIndex}`).alignment = { horizontal: 'center' };
  rowIndex += 1;
  sheet.mergeCells(`A${rowIndex}:${lastCol}${rowIndex}`);
  sheet.getCell(`A${rowIndex}`).value = `PERIODE ${formatMutationExportDate(startDate)} - ${formatMutationExportDate(endDate)}`;
  sheet.getCell(`A${rowIndex}`).font = { bold: true, size: 11 };
  sheet.getCell(`A${rowIndex}`).alignment = { horizontal: 'center' };
  rowIndex += 2;

  const headerLabels = [
    'TANGGAL',
    'KETERANGAN (CATATAN)',
    'IN',
    'OUT',
    'ADJ',
    'SALDO',
    'SATUAN',
    'DIBUAT',
    'TANGGAL BUAT',
  ];

  const thinBorder = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' },
  };

  sections.forEach((section) => {
    sheet.getCell(`A${rowIndex}`).value = 'DIVISI :';
    sheet.getCell(`A${rowIndex}`).font = { bold: true, size: 11 };
    sheet.getCell(`B${rowIndex}`).value = section.divisionName;
    sheet.getCell(`B${rowIndex}`).font = { bold: true, size: 11 };
    rowIndex += 2;

    section.items.forEach((itemSection) => {
      sheet.getCell(`A${rowIndex}`).value = 'NAMA :';
      sheet.getCell(`A${rowIndex}`).font = { bold: true, size: 10 };
      sheet.getCell(`B${rowIndex}`).value = itemSection.itemName;
      sheet.getCell(`B${rowIndex}`).font = { bold: true, size: 10 };
      sheet.getCell(`G${rowIndex}`).value = 'Jenis Barang :';
      sheet.getCell(`G${rowIndex}`).font = { bold: true, size: 10 };
      sheet.getCell(`H${rowIndex}`).value = itemSection.groupName;
      sheet.getCell(`H${rowIndex}`).font = { bold: true, size: 10 };
      sheet.mergeCells(`H${rowIndex}:I${rowIndex}`);

      rowIndex += 1;
      sheet.getCell(`A${rowIndex}`).value = 'EXP DATE :';
      sheet.getCell(`A${rowIndex}`).font = { bold: true, size: 10 };
      sheet.getCell(`B${rowIndex}`).value = itemSection.expiryDate;
      sheet.getCell(`B${rowIndex}`).font = { bold: true, size: 10 };
      rowIndex += 1;

      const headerRow = sheet.getRow(rowIndex);
      headerLabels.forEach((label, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = label;
        cell.font = { bold: true, size: 9 };
        cell.alignment = { horizontal: idx === 2 || idx === 3 || idx === 4 || idx === 5 ? 'center' : 'left' };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFEFEFEF' },
        };
        cell.border = thinBorder;
      });
      rowIndex += 1;

      itemSection.rows.forEach((entry) => {
        const row = sheet.getRow(rowIndex);
        const values = [
          entry.date,
          entry.note,
          entry.inQty ? Number(entry.inQty) : '',
          entry.outQty ? Number(entry.outQty) : '',
          entry.adjQty ? Number(entry.adjQty) : '',
          Number(entry.saldo || 0),
          entry.unit,
          entry.createdBy,
          entry.createdAt,
        ];
        values.forEach((value, idx) => {
          const cell = row.getCell(idx + 1);
          cell.value = value;
          cell.border = thinBorder;
          cell.font = { size: 9 };
          cell.alignment = {
            horizontal: idx >= 2 && idx <= 5 ? 'center' : 'left',
          };
        });
        rowIndex += 1;
      });

      const totalRow = sheet.getRow(rowIndex);
      totalRow.getCell(2).value = 'TOTAL';
      totalRow.getCell(2).font = { bold: true };
      totalRow.getCell(3).value = Number(itemSection.totals.inQty || 0);
      totalRow.getCell(4).value = Number(itemSection.totals.outQty || 0);
      totalRow.getCell(5).value = Number(itemSection.totals.adjQty || 0);
      totalRow.getCell(6).value = Number(itemSection.totals.saldo || 0);
      for (let idx = 1; idx <= 9; idx += 1) {
        const cell = totalRow.getCell(idx);
        cell.font = { bold: true, size: 9 };
        cell.border = thinBorder;
        cell.alignment = { horizontal: idx >= 3 && idx <= 6 ? 'center' : 'left' };
      }
      rowIndex += 2;
    });
  });

  [3, 4, 5, 6].forEach((idx) => {
    sheet.getColumn(idx).numFmt = '#,##0.##';
  });

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}

function exportMutationPdf(res, filename, title, companyName, startDate, endDate, groupedRows) {
  const doc = new PDFDocument({
    margin: 22,
    size: 'A4',
    layout: 'portrait',
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  doc.pipe(res);

  const sections = normalizeMutationRows(groupedRows);
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const startX = doc.page.margins.left;
  const columns = [
    { label: 'TANGGAL', width: 46, align: 'left' },
    { label: 'KETERANGAN', width: 150, align: 'left' },
    { label: 'IN', width: 30, align: 'center' },
    { label: 'OUT', width: 30, align: 'center' },
    { label: 'ADJ', width: 30, align: 'center' },
    { label: 'SALDO', width: 36, align: 'center' },
    { label: 'SATUAN', width: 38, align: 'left' },
    { label: 'DIBUAT', width: 56, align: 'left' },
    { label: 'TGL BUAT', width: 58, align: 'left' },
  ];

  const drawRow = (y, values, options = {}) => {
    let currentX = startX;
    let rowHeight = 16;
    values.forEach((value, idx) => {
      const text = value === null || value === undefined ? '' : String(value);
      const height = doc.heightOfString(text, {
        width: columns[idx].width - 6,
        align: columns[idx].align,
      }) + 8;
      rowHeight = Math.max(rowHeight, height);
    });

    values.forEach((value, idx) => {
      doc.rect(currentX, y, columns[idx].width, rowHeight).stroke('#444');
      if (options.fillHeader) {
        doc.save();
        doc.rect(currentX, y, columns[idx].width, rowHeight).fillAndStroke('#efefef', '#444');
        doc.restore();
      }
      doc
        .font(options.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(options.fontSize || 6.8)
        .fillColor('#111')
        .text(value === null || value === undefined ? '' : String(value), currentX + 3, y + 4, {
          width: columns[idx].width - 6,
          align: columns[idx].align,
        });
      currentX += columns[idx].width;
    });

    return rowHeight;
  };

  const pageBottom = () => doc.page.height - doc.page.margins.bottom;
  const addMutationPage = () => {
    doc.addPage({ size: 'A4', layout: 'portrait', margin: 22 });
    return doc.y;
  };

  doc.font('Helvetica-Bold').fontSize(12).text(String(companyName || '-').toUpperCase(), {
    align: 'center',
  });
  doc.moveDown(0.2);
  doc.font('Helvetica-Bold').fontSize(11).text('MUTASI BARANG', {
    align: 'center',
  });
  doc.moveDown(0.15);
  doc.font('Helvetica-Bold').fontSize(10).text(
    `PERIODE ${formatMutationExportDate(startDate)} - ${formatMutationExportDate(endDate)}`,
    { align: 'center' }
  );
  doc.moveDown(0.7);

  const drawItemHeader = (sectionName, itemSection, includeDivisionTitle = false) => {
    if (includeDivisionTitle) {
      doc.font('Helvetica-Bold').fontSize(10).text(`DIVISI: ${sectionName}`, startX, doc.y);
      doc.moveDown(0.55);
    }
    const topY = doc.y;
    const rightLabelX = startX + 380;
    const rightValueX = rightLabelX + 82;
    const rightValueWidth = Math.max(80, startX + pageWidth - rightValueX);
    doc.font('Helvetica-Bold').fontSize(8.5).text('NAMA:', startX, topY);
    doc.font('Helvetica-Bold').fontSize(8.5).text(itemSection.itemName, startX + 46, topY, {
      width: rightLabelX - startX - 52,
    });
    doc.font('Helvetica-Bold').fontSize(8.5).text('Jenis Barang :', rightLabelX, topY);
    doc.font('Helvetica-Bold').fontSize(8.5).text(itemSection.groupName, rightValueX, topY, {
      width: rightValueWidth,
    });

    const secondY = topY + 14;
    doc.font('Helvetica-Bold').fontSize(8.5).text('EXP DATE:', startX, secondY);
    doc.font('Helvetica-Bold').fontSize(8.5).text(itemSection.expiryDate, startX + 46, secondY);

    let y = secondY + 16;
    y += drawRow(
      y,
      columns.map((col) => col.label),
      { fillHeader: true, bold: true, fontSize: 7.2 }
    );
    return y;
  };

  sections.forEach((section) => {
    if (doc.y + 50 > pageBottom()) {
      addMutationPage();
    }
    doc.font('Helvetica-Bold').fontSize(11).text(`DIVISI: ${section.divisionName}`, startX, doc.y);
    doc.moveDown(0.7);

    section.items.forEach((itemSection) => {
      if (doc.y + 110 > pageBottom()) {
        addMutationPage();
      }
      let y = drawItemHeader(section.divisionName, itemSection, false);

      itemSection.rows.forEach((entry) => {
        if (y + 22 > pageBottom()) {
          addMutationPage();
          y = drawItemHeader(section.divisionName, itemSection, false);
        }
        const values = [
          entry.date,
          entry.note,
          entry.inQty ? formatMutationQty(entry.inQty) : '',
          entry.outQty ? formatMutationQty(entry.outQty) : '',
          entry.adjQty ? formatMutationQty(entry.adjQty) : '',
          formatMutationQty(entry.saldo),
          entry.unit,
          entry.createdBy,
          entry.createdAt,
        ];
        y += drawRow(y, values, { fontSize: 6.8 });
      });

      if (y + 22 > pageBottom()) {
        addMutationPage();
        y = drawItemHeader(section.divisionName, itemSection, false);
      }
      const totalValues = [
        '',
        'TOTAL',
        formatMutationQty(itemSection.totals.inQty),
        formatMutationQty(itemSection.totals.outQty),
        formatMutationQty(itemSection.totals.adjQty),
        formatMutationQty(itemSection.totals.saldo),
        '',
        '',
        '',
      ];
      y += drawRow(y, totalValues, { bold: true, fontSize: 6.8 });
      doc.y = y + 14;
    });
  });

  doc.end();
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
  doc.moveDown(0.4);

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

module.exports = {
  exportCsv,
  exportExcel,
  exportPdf,
  exportMutationExcel,
  exportMutationPdf,
};
