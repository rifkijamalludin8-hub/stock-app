const { query } = require('./pg');

async function listCompanies() {
  return query('SELECT * FROM companies ORDER BY name ASC');
}

async function getCompanyById(id) {
  const rows = await query('SELECT * FROM companies WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getCompanyBySlug(slug) {
  const rows = await query('SELECT * FROM companies WHERE slug = $1', [slug]);
  return rows[0] || null;
}

async function createCompany({ name, slug }) {
  const rows = await query(
    'INSERT INTO companies (name, slug, logo_path) VALUES ($1, $2, $3) RETURNING *',
    [name, slug, null]
  );
  return rows[0];
}

async function updateCompanyLogo(id, logoPath) {
  await query('UPDATE companies SET logo_path = $1 WHERE id = $2', [logoPath, id]);
}

async function deleteCompanyById(id) {
  await query('DELETE FROM companies WHERE id = $1', [id]);
}

module.exports = {
  listCompanies,
  getCompanyById,
  getCompanyBySlug,
  createCompany,
  deleteCompanyById,
  updateCompanyLogo,
};
