const ProctorLog = require('../models/ProctorLog');

// POST /api/proctor-log — called by exam-proctor.js whenever it logs an event
exports.createLog = async (req, res) => {
  try {
    const { type, detail, page } = req.body;
    if (!type) return res.status(400).json({ message: 'type is required.' });
    const log = await ProctorLog.create({ student: req.student.id, type, detail, page });
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
