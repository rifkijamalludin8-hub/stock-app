const bcrypt = require('bcryptjs');
const { getCompanyById } = require('../db/master');
const { query } = require('../db/pg');

async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

async function requireCompany(req, res, next) {
  if (!req.session.companyId) return res.redirect('/select-company');
  const company = await getCompanyById(req.session.companyId);
  if (!company) {
    req.session.companyId = null;
    return res.redirect('/select-company');
  }
  req.company = company;
  req.db = { query };
  res.locals.company = company;
  res.locals.divisionWarning = null;
  return next();
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  res.locals.user = req.session.user;
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    if (req.session.user.role !== role) return res.status(403).render('pages/forbidden');
    next();
  };
}

function canSeePrice(req) {
  return req.session.user && req.session.user.role === 'user';
}

module.exports = {
  hashPassword,
  comparePassword,
  requireCompany,
  requireAuth,
  requireRole,
  canSeePrice,
};
