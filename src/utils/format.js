function formatPrice(value) {
  if (value === null || value === undefined || value === '') return '-';
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return '-';
  const formatted = new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numberValue);
  return formatted;
}

function parsePrice(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const value = String(raw).trim();
  if (value === '') return null;

  const hasComma = value.includes(',');
  const hasDot = value.includes('.');
  let normalized = value;

  if (hasComma && hasDot) {
    const lastComma = value.lastIndexOf(',');
    const lastDot = value.lastIndexOf('.');
    const decimalSeparator = lastComma > lastDot ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
    normalized = value.split(thousandsSeparator).join('');
    normalized = normalized.replace(decimalSeparator, '.');
  } else if (hasComma) {
    const parts = value.split(',');
    const last = parts[parts.length - 1] || '';
    if (last.length === 3 && parts.length === 2) {
      normalized = value.replace(/,/g, '');
    } else {
      normalized = value.replace(/,/g, '.');
    }
  } else if (hasDot) {
    const parts = value.split('.');
    const last = parts[parts.length - 1] || '';
    if (last.length === 3 && parts.length === 2) {
      normalized = value.replace(/\./g, '');
    } else {
      normalized = value;
    }
  }

  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) ? numberValue : null;
}

module.exports = { formatPrice, parsePrice };
