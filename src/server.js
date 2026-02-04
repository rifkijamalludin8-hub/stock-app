const express = require('express');
const path = require('path');
const session = require('express-session');
const { flashMiddleware } = require('./utils/flash');
const { listCompanies } = require('./db/master');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const groupsRoutes = require('./routes/groups');
const itemsRoutes = require('./routes/items');
const transactionsRoutes = require('./routes/transactions');
const adjustmentsRoutes = require('./routes/adjustments');
const usersRoutes = require('./routes/users');
const reportsRoutes = require('./routes/reports');
const exportsRoutes = require('./routes/exports');

const app = express();

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'stock-secret',
    resave: false,
    saveUninitialized: false,
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
  next();
});

app.use(authRoutes);
app.use(exportsRoutes);
app.use(dashboardRoutes);
app.use(groupsRoutes);
app.use(itemsRoutes);
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
});
