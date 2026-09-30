const CodingQuestion = require('../models/CodingQuestion');
const SecondLevelExam = require('../models/SecondLevelExam');

exports.listActiveCodingQuestions = async (req, res) => {
  const currentExam = await SecondLevelExam.findOne({ active: true }).sort({ createdAt: -1 });
  const filter = { active: true };
  if (currentExam && currentExam.difficulty) filter.difficulty = currentExam.difficulty;
  const questions = await CodingQuestion.find(filter).sort({ createdAt: 1 });
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
  try {
    const items = Array.isArray(req.body.questions) ? req.body.questions : [];
    const existingTitles = new Set((await CodingQuestion.find({}, 'title')).map(q => q.title.trim().toLowerCase()));
    const toInsert = items.filter(q => q.title && !existingTitles.has(q.title.trim().toLowerCase()));
    const inserted = toInsert.length ? await CodingQuestion.insertMany(toInsert) : [];
    res.status(201).json({ inserted: inserted.length, duplicates: items.length - toInsert.length });
  } catch (err) {
    res.status(500).json({ message: 'Bulk insert failed.' });
  }
};