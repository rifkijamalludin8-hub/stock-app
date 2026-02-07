const express = require('express');
const path = require('path');
const session = require('express-session');
const connectRedis = require('connect-redis');
const { createClient } = require('redis');
const { flashMiddleware } = require('./utils/flash');
const { formatPrice, formatDateTime, formatDate, formatQty } = require('./utils/format');
const { scheduleAutoBackup } = require('./utils/backup');
const { listCompanies } = require('./db/master');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const groupsRoutes = require('./routes/groups');
const divisionsRoutes = require('./routes/divisions');
const itemsRoutes = require('./routes/items');
const settingsRoutes = require('./routes/settings');
const openingRoutes = require('./routes/opening');
const transactionsRoutes = require('./routes/transactions');
const adjustmentsRoutes = require('./routes/adjustments');
const usersRoutes = require('./routes/users');
const reportsRoutes = require('./routes/reports');
const mutationsRoutes = require('./routes/mutations');
const exportsRoutes = require('./routes/exports');

const app = express();

let redisClient = null;
let sessionStore;
if (process.env.REDIS_URL) {
  const RedisStore = connectRedis.RedisStore || connectRedis.default || connectRedis;
  redisClient = createClient({ url: process.env.REDIS_URL });
  redisClient.on('error', (err) => console.error('Redis error', err));
  redisClient
    .connect()
    .then(() => console.log('Redis connected'))
    .catch((err) => console.error('Redis connect error', err));
  sessionStore = new RedisStore({ client: redisClient });
}

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
const safeFormatPrice =
  typeof formatPrice === 'function' ? formatPrice : (value) => (value === null || value === undefined ? '-' : String(value));
const safeFormatDateTime =
  typeof formatDateTime === 'function' ? formatDateTime : (value) => (value ? String(value) : '-');
const safeFormatDate =
  typeof formatDate === 'function' ? formatDate : (value) => (value ? String(value) : '-');
const safeFormatQty =
  typeof formatQty === 'function' ? formatQty : (value) => (value === null || value === undefined ? '0' : String(value));

app.locals.formatPrice = safeFormatPrice;
app.locals.formatDateTime = safeFormatDateTime;
app.locals.formatDate = safeFormatDate;
app.locals.formatQty = safeFormatQty;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
app.use('/uploads', express.static(path.join(dataDir, 'uploads')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'stock-secret',
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  })
);

app.use(flashMiddleware);

app.use(async (req, res, next) => {
  res.locals.user = req.session.user || null;
  try {
    const companies = await listCompanies();
    res.locals.companiesCount = companies.length;
  } catch (err) {
    res.locals.companiesCount = 0;
  }
  res.locals.currentYear = new Date().getFullYear();
  res.locals.requireSetupKey = Boolean(process.env.SETUP_KEY);
  res.locals.divisionWarning = null;
  res.locals.formatPrice = safeFormatPrice;
  res.locals.formatDateTime = safeFormatDateTime;
  res.locals.formatDate = safeFormatDate;
  res.locals.formatQty = safeFormatQty;
  next();
});

app.use(authRoutes);
app.use(exportsRoutes);
app.use(dashboardRoutes);
app.use(groupsRoutes);
app.use(divisionsRoutes);
app.use(itemsRoutes);
app.use(settingsRoutes);
app.use(openingRoutes);
app.use(transactionsRoutes);
app.use(adjustmentsRoutes);
app.use(usersRoutes);
app.use(reportsRoutes);
app.use(mutationsRoutes);

app.get('/forbidden', (req, res) => {
  res.render('pages/forbidden');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
  scheduleAutoBackup();
});
