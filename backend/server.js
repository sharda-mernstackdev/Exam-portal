require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

const authRoutes = require('./routes/authRoutes');
const questionRoutes = require('./routes/questionRoutes');
const codingQuestionRoutes = require('./routes/codingQuestionRoutes');
const examRoutes = require('./routes/examRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const submissionRoutes = require('./routes/submissionRoutes');
const studentRoutes = require('./routes/studentRoutes');

const app = express();

// ---- Core middleware ----
app.use(express.json({ limit: '2mb' }));

const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow tools like curl/Postman (no origin) and any configured origin.
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true
  })
);

// ---- Routes ----
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api', questionRoutes);
app.use('/api', codingQuestionRoutes);
app.use('/api', examRoutes);
app.use('/api', settingsRoutes);
app.use('/api', submissionRoutes);
app.use('/api', studentRoutes);

// ---- 404 + error handling ----
app.use((req, res) => res.status(404).json({ message: 'Not found.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || 'Server error.' });
});

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => console.log(`[server] Exam Portal API running on http://localhost:${PORT}`));
});
