const dayjs = require('dayjs');

function formatDate(date) {
  if (!date) return '';
  return dayjs(date).format('YYYY-MM-DD');
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = { formatDate, nowIso };
