const Exam = require('../models/Exam');
const SecondLevelExam = require('../models/SecondLevelExam');

// If `sectionIds` is present on the payload, this record is a combined
// "Test" — auto-sum its duration and total-questions target from the
// referenced section exams so the admin never has to type them by hand.
// Returns the payload unchanged when sectionIds is absent/empty (a plain
// section exam behaves exactly as before).
async function withComputedTotals(body) {
  if (!Array.isArray(body.sectionIds) || body.sectionIds.length === 0) return body;
  const sections = await Exam.find({ _id: { $in: body.sectionIds } });
  const durationMinutes = sections.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
  const totalQuestionsTarget = sections.reduce((sum, s) => sum + (s.totalQuestionsTarget || 0), 0);
  return { ...body, durationMinutes, totalQuestionsTarget };
}

// ---- Round 1 exams (examList) ----
exports.listExams = async (req, res) => {
  res.json(await Exam.find().sort({ createdAt: -1 }));
};

exports.createExam = async (req, res) => {
  const exam = await Exam.create(await withComputedTotals(req.body));
  res.status(201).json(exam);
};

exports.updateExam = async (req, res) => {
  const exam = await Exam.findByIdAndUpdate(req.params.id, await withComputedTotals(req.body), { new: true });
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