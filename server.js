const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const multer = require('multer');
const pdfParse = require('pdf-parse');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// ===== SESSION + PASSPORT =====
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 days
}));

app.use(passport.initialize());
app.use(passport.session());

// Trust Railway's proxy so req.protocol is 'https'
app.set('trust proxy', 1);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

const callbackURL = process.env.GOOGLE_CALLBACK_URL || 'https://germanteacher-production.up.railway.app/auth/google/callback';

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL
}, (accessToken, refreshToken, profile, done) => {
  const user = {
    id: profile.id,
    name: profile.displayName,
    email: profile.emails?.[0]?.value || ''
  };
  done(null, user);
}));

// ===== AUTH ROUTES =====
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login.html' }),
  (req, res) => res.redirect('/')
);

app.get('/auth/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/login.html');
  });
});

// ===== AUTH MIDDLEWARE =====
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

// ===== PER-USER DATA =====
function getUserDataFile(userId) {
  return path.join(DATA_DIR, `user_${userId}.json`);
}

function getUserData(userId) {
  const file = getUserDataFile(userId);
  if (!fs.existsSync(file)) {
    const initial = { documents: {}, annotations: {}, positions: {}, settings: {} };
    fs.writeFileSync(file, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function saveUserData(userId, data) {
  const file = getUserDataFile(userId);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ===== MULTER =====
const upload = multer({
  dest: UPLOADS_DIR,
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'text/plain'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(file.mimetype) || ext === '.txt' || ext === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and .txt files are supported'));
    }
  }
});

// ===== MIDDLEWARE =====
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===== PUBLIC ROUTES =====
app.get('/api/ping', (req, res) => res.json({ ok: true }));

app.get('/api/user', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ id: req.user.id, name: req.user.name, email: req.user.email });
});

// ===== PROTECTED ROUTES =====
app.get('/api/data', requireAuth, (req, res) => {
  try {
    const data = getUserData(req.user.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Could not read data file' });
  }
});

app.put('/api/data', requireAuth, (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || !body.documents || !body.annotations || !body.positions) {
      return res.status(400).json({ error: 'Invalid data structure' });
    }
    if (!body.settings) body.settings = {};
    saveUserData(req.user.id, body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not write data file' });
  }
});

app.post('/api/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const filePath = req.file.path;
  const originalName = req.file.originalname;
  const ext = path.extname(originalName).toLowerCase();

  let text = '';
  try {
    if (ext === '.pdf') {
      const buffer = fs.readFileSync(filePath);
      const parsed = await pdfParse(buffer);
      text = parsed.text;
      if (!text || text.trim().length === 0) {
        fs.unlinkSync(filePath);
        return res.status(422).json({ error: 'Could not extract text from PDF. The file may be image-only.' });
      }
    } else {
      text = fs.readFileSync(filePath, 'utf8');
    }
  } catch (err) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return res.status(422).json({ error: 'Could not parse file: ' + err.message });
  }

  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  const docId = crypto.randomUUID();
  const data = getUserData(req.user.id);
  data.documents[docId] = {
    title: originalName,
    text: text,
    uploadedAt: Date.now()
  };
  if (!data.annotations[docId]) data.annotations[docId] = [];
  saveUserData(req.user.id, data);

  res.json({ docId, title: originalName, charCount: text.length });
});

app.delete('/api/document/:docId', requireAuth, (req, res) => {
  try {
    const { docId } = req.params;
    const data = getUserData(req.user.id);
    delete data.documents[docId];
    delete data.annotations[docId];
    delete data.positions[docId];
    saveUserData(req.user.id, data);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete document' });
  }
});

// Admin: list user data files on the volume
app.get('/api/admin/files', requireAuth, (req, res) => {
  try {
    const files = fs.readdirSync(DATA_DIR);
    const info = files.map(f => {
      const stat = fs.statSync(path.join(DATA_DIR, f));
      return { name: f, size: stat.size, modified: stat.mtime };
    });
    res.json({ dataDir: DATA_DIR, files: info });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`German Teacher v1.2 running at http://localhost:${PORT}`);
});
