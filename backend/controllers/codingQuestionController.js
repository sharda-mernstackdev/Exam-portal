const CodingQuestion = require('../models/CodingQuestion');
const SecondLevelExam = require('../models/SecondLevelExam');

// GET /api/coding-questions — student-facing, hides the `hidden: true` test cases' expected output?
// (kept simple: still needed client-side to run visible examples; hidden test cases are still required
// for scoring so we return everything but the frontend must not display hidden ones in the UI.)
//
// The Round 2 question bank is organised into three sets by `difficulty`
// (Easy/Medium/Hard). Whichever set the currently active Round 2 exam
// config was created with (its own `difficulty` field, chosen in the
// "Create Test Cases Exam Configuration" form) is the set every candidate
// gets here — same "current active SecondLevelExam" lookup used elsewhere
// (submissionController) to pick which Round 2 config is live right now.
// A config with no difficulty set (or none configured yet) falls back to
// the full active bank, so nothing breaks for exams created before this.
exports.listActiveCodingQuestions = async (req, res) => {
  const currentExam = await SecondLevelExam.findOne({ active: true }).sort({ createdAt: -1 });
  const filter = { active: true };
  if (currentExam) {
    // Several difficulty sets can be ticked on one config; older configs only
    // have the single `difficulty` field.
    const levels = currentExam.difficulties && currentExam.difficulties.length
      ? currentExam.difficulties
      : (currentExam.difficulty ? [currentExam.difficulty] : []);
    if (levels.length) filter.difficulty = { $in: levels };
  }
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

// POST /api/admin/coding-questions/bulk — CSV import for the Round 2 bank.
// Dedupes by title (same approach as the Round 1 question bank's bulk
// import) so re-uploading an edited CSV only adds the new rows instead of
// refusing outright once the bank has anything in it.
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