const CodingQuestion = require('../models/CodingQuestion');
const SecondLevelExam = require('../models/SecondLevelExam');
const CodingSet = require('../models/CodingSet');
const { isMobileRequest, MOBILE_BLOCK_MESSAGE } = require('../utils/device');

// GET /api/coding-questions - student-facing: the Round 2 paper (text-box questions
// and MCQs). The correct answers are never sent to the browser.
//
// The paper is made from the question sets (Text answer / MCQ) of the currently
// active Round 2 test — same "current active SecondLevelExam" lookup used elsewhere
// (submissionController) to pick which Round 2 test is live right now.
exports.listActiveCodingQuestions = async (req, res) => {
  // The Round 2 paper is never served to a phone or tablet.
  if (isMobileRequest(req)) {
    return res.status(403).json({ message: MOBILE_BLOCK_MESSAGE });
  }
  const paper = await getActiveCodingQuestions();
  // The browser never receives the correct answers.
  res.json(paper.map((q) => ({
    _id: q._id,
    type: q.type,
    title: q.title,
    difficulty: q.difficulty,
    description: q.description,
    options: q.type === 'mcq' ? q.options : []
  })));
};

// Text-box questions and MCQs are mixed: the MCQs are spread evenly between the
// text-box questions (same order for every candidate). Inside each kind the
// order is the order the admin added them.
function mixQuestions(list) {
  const texts = list.filter((q) => q.type !== 'mcq');
  const mcqs = list.filter((q) => q.type === 'mcq');
  const n = list.length;
  const out = [];
  let ti = 0;
  let mi = 0;
  for (let pos = 0; pos < n; pos++) {
    const takeMcq = mi < mcqs.length && (ti >= texts.length || (pos + 1) >= ((mi + 1) * n) / (mcqs.length + 1));
    out.push(takeMcq ? mcqs[mi++] : texts[ti++]);
  }
  return out;
}

// The Round 2 paper currently in force. Shared with Round 2 submission checking
// so both agree on which questions are valid. Only text-box and MCQ questions
// are part of the paper (the old compile-and-run questions are not used any more).
async function getActiveCodingQuestions() {
  const currentExam = await SecondLevelExam.findOne({ active: true }).sort({ createdAt: -1 });
  // A test made from question sets (Text answer / MCQ): the paper is all the
  // active questions of the types of its active sets.
  if (currentExam && currentExam.sectionIds && currentExam.sectionIds.length) {
    const sets = await CodingSet.find({ _id: { $in: currentExam.sectionIds }, active: true });
    const types = sets.map((st) => st.type);
    const picked = await CodingQuestion.find({ active: true, type: { $in: types } }).sort({ createdAt: 1, _id: 1 });
    return mixQuestions(picked);
  }
  // A test with no question sets (made long ago) gets all the active questions.
  const list = await CodingQuestion.find({ active: true, type: { $in: ['text', 'mcq'] } }).sort({ createdAt: 1, _id: 1 });
  return mixQuestions(list);
}
exports.getActiveCodingQuestions = getActiveCodingQuestions;
exports.mixQuestions = mixQuestions;

exports.listAllCodingQuestions = async (req, res) => {
  const questions = await CodingQuestion.find().sort({ createdAt: 1 });
  res.json(questions);
};

// Checks a text-box / MCQ question sent by the admin. Returns an error text or ''.
function questionProblem(q) {
  if (!q || !String(q.description || '').trim()) return 'The question text is required.';
  if (q.type === 'text') {
    if (!String(q.answer || '').trim()) return 'The correct answer is required.';
  } else if (q.type === 'mcq') {
    const opts = Array.isArray(q.options) ? q.options.map((o) => String(o || '').trim()) : [];
    if (opts.length < 2 || opts.some((o) => !o)) return 'An MCQ needs at least 2 options and none can be empty.';
    const c = Number(q.correctIndex);
    if (!Number.isInteger(c) || c < 0 || c >= opts.length) return 'Choose the correct option.';
  } else {
    return 'Question type must be Text answer or MCQ.';
  }
  return '';
}

exports.createCodingQuestion = async (req, res) => {
  try {
    const bad = questionProblem(req.body);
    if (bad) return res.status(400).json({ message: bad });
    const question = await CodingQuestion.create(req.body);
    res.status(201).json(question);
  } catch (err) {
    res.status(500).json({ message: 'Could not create question.' });
  }
};

exports.updateCodingQuestion = async (req, res) => {
  // `active` alone may be toggled; a full edit is checked like a new question.
  if (Object.keys(req.body || {}).some((k) => k !== 'active')) {
    const bad = questionProblem(req.body);
    if (bad) return res.status(400).json({ message: bad });
  }
  const question = await CodingQuestion.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!question) return res.status(404).json({ message: 'Question not found.' });
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
    const valid = items.filter(q => q.title && !questionProblem(q));
    const toInsert = valid.filter(q => !existingTitles.has(q.title.trim().toLowerCase()));
    const inserted = toInsert.length ? await CodingQuestion.insertMany(toInsert) : [];
    res.status(201).json({ inserted: inserted.length, duplicates: valid.length - toInsert.length, invalid: items.length - valid.length });
  } catch (err) {
    res.status(500).json({ message: 'Bulk insert failed.' });
  }
};