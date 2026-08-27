const CodingQuestion = require('../models/CodingQuestion');

// GET /api/coding-questions — student-facing, hides the `hidden: true` test cases' expected output? 
// (kept simple: still needed client-side to run visible examples; hidden test cases are still required
// for scoring so we return everything but the frontend must not display hidden ones in the UI.)
exports.listActiveCodingQuestions = async (req, res) => {
  const questions = await CodingQuestion.find({ active: true }).sort({ createdAt: 1 });
  res.json(questions);
};

exports.listAllCodingQuestions = async (req, res) => {
  const questions = await CodingQuestion.find().sort({ createdAt: 1 });
  res.json(questions);
};

exports.createCodingQuestion = async (req, res) => {
  try {
    const question = await CodingQuestion.create(req.body);
    res.status(201).json(question);
  } catch (err) {
    res.status(500).json({ message: 'Could not create coding question.' });
  }
};

exports.updateCodingQuestion = async (req, res) => {
  const question = await CodingQuestion.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!question) return res.status(404).json({ message: 'Coding question not found.' });
  res.json(question);
};

exports.deleteCodingQuestion = async (req, res) => {
  const question = await CodingQuestion.findByIdAndDelete(req.params.id);
  if (!question) return res.status(404).json({ message: 'Coding question not found.' });
  res.json({ message: 'Coding question deleted.' });
};

exports.bulkCreateCodingQuestions = async (req, res) => {
  const items = Array.isArray(req.body.questions) ? req.body.questions : [];
  const count = await CodingQuestion.countDocuments();
  if (count > 0) return res.status(200).json({ inserted: 0, message: 'Bank already seeded.' });
  const inserted = items.length ? await CodingQuestion.insertMany(items) : [];
  res.status(201).json({ inserted: inserted.length });
};
