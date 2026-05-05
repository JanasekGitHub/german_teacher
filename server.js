const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// Ensure data.json exists with initial structure
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ documents: {}, annotations: {}, positions: {}, settings: {} }, null, 2));
}

// Multer config — accept only PDF and plain text
const upload = multer({
  dest: UPLOADS_DIR,
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'text/plain'];
    // Some systems send .txt files with a different mime type
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(file.mimetype) || ext === '.txt' || ext === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and .txt files are supported'));
    }
  }
});

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/api/ping', (req, res) => res.json({ ok: true }));

// GET full data
app.get('/api/data', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Could not read data file' });
  }
});

// PUT full data (replace)
app.put('/api/data', (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || !body.documents || !body.annotations || !body.positions) {
      return res.status(400).json({ error: 'Invalid data structure' });
    }
    if (!body.settings) body.settings = {};
    fs.writeFileSync(DATA_FILE, JSON.stringify(body, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not write data file' });
  }
});

// POST upload — parse file and store text in data.json
app.post('/api/upload', upload.single('file'), async (req, res) => {
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

  // Delete temp file
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  // Store in data.json
  const docId = crypto.randomUUID();
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  data.documents[docId] = {
    title: originalName,
    text: text,
    uploadedAt: Date.now()
  };
  if (!data.annotations[docId]) data.annotations[docId] = [];
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

  res.json({ docId, title: originalName, charCount: text.length });
});

// Delete a document
app.delete('/api/document/:docId', (req, res) => {
  try {
    const { docId } = req.params;
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    delete data.documents[docId];
    delete data.annotations[docId];
    delete data.positions[docId];
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete document' });
  }
});

app.listen(PORT, () => {
  console.log(`German Teacher running at http://localhost:${PORT}`);
});
