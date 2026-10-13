const ProctorLog = require('../models/ProctorLog');

// POST /api/proctor-log — called by exam-proctor.js whenever it logs an event
exports.createLog = async (req, res) => {
  try {
    const { type, detail, page } = req.body;
    if (!type || typeof type !== 'string') return res.status(400).json({ message: 'type is required.' });
    // Identity and time come from the server (token / clock), never from the
    // browser; the free-text fields are length-limited so the log cannot be
    // flooded with junk.
    const log = await ProctorLog.create({
      student: req.student.id,
      type: type.slice(0, 60),
      detail: typeof detail === 'string' ? detail.slice(0, 500) : '',
      page: typeof page === 'string' ? page.slice(0, 80) : ''
    });
    res.status(201).json(log);
  } catch (err) {
    res.status(500).json({ message: 'Could not save proctor log.' });
  }
};

// GET /api/admin/proctor-logs
exports.listLogs = async (req, res) => {
  const logs = await ProctorLog.find().populate('student', 'fullName email').sort({ at: -1 }).limit(500);
  res.json(logs);
};