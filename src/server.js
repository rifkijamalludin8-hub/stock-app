const express = require('express');
const path = require('path');
const session = require('express-session');
const connectRedis = require('connect-redis');
const { createClient } = require('redis');
const { flashMiddleware } = require('./utils/flash');
const { formatPrice, formatDateTime } = require('./utils/format');
const { scheduleAutoBackup } = require('./utils/backup');
const { listCompanies, dataDir } = require('./db/master');

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

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
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

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.companiesCount = listCompanies().length;
  res.locals.currentYear = new Date().getFullYear();
  res.locals.requireSetupKey = Boolean(process.env.SETUP_KEY);
  res.locals.divisionWarning = null;
  res.locals.formatPrice = formatPrice;
  res.locals.formatDateTime = formatDateTime;
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

app.get('/forbidden', (req, res) => {
  res.render('pages/forbidden');
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
  scheduleAutoBackup();
});
