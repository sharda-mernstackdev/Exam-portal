const Exam = require('../models/Exam');
const SecondLevelExam = require('../models/SecondLevelExam');

// ---- Round 1 exams (examList) ----
exports.listExams = async (req, res) => {
  res.json(await Exam.find().sort({ createdAt: -1 }));
};

exports.createExam = async (req, res) => {
  const exam = await Exam.create(req.body);
  res.status(201).json(exam);
};

exports.updateExam = async (req, res) => {
  const exam = await Exam.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!exam) return res.status(404).json({ message: 'Exam not found.' });
  res.json(exam);
};

exports.deleteExam = async (req, res) => {
  const exam = await Exam.findByIdAndDelete(req.params.id);
  if (!exam) return res.status(404).json({ message: 'Exam not found.' });
  res.json({ message: 'Exam deleted.' });
};

// ---- Round 2 exams (secondLevelExams) ----
exports.listSecondLevelExams = async (req, res) => {
  res.json(await SecondLevelExam.find().populate('questionIds').sort({ createdAt: -1 }));
};

exports.createSecondLevelExam = async (req, res) => {
  const exam = await SecondLevelExam.create(req.body);
  res.status(201).json(exam);
};

exports.updateSecondLevelExam = async (req, res) => {
  const exam = await SecondLevelExam.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!exam) return res.status(404).json({ message: 'Second-level exam not found.' });
  res.json(exam);
};

exports.deleteSecondLevelExam = async (req, res) => {
  const exam = await SecondLevelExam.findByIdAndDelete(req.params.id);
  if (!exam) return res.status(404).json({ message: 'Second-level exam not found.' });
  res.json({ message: 'Second-level exam deleted.' });
};
