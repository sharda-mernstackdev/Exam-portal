const Question = require('../models/Question');
const Exam = require('../models/Exam');
const ExamAssignment = require('../models/ExamAssignment');
const { paperLoadDeadline } = require('../utils/examWindow');

// Allowance for network delay / tiny clock differences when the exam opens.
const START_TOLERANCE_MS = 3000;

// Looks up whether `category` has an exam target set, and how many
// questions already exist for it. Returns null if no exam matches this
// category (in which case there's no cap — old free-form categories keep
// working exactly as before).
async function getCategoryLimit(category) {
  const exam = await Exam.findOne({ title: new RegExp('^' + category.trim() + '$', 'i') });
  if (!exam || !exam.totalQuestionsTarget) return null;
  const currentCount = await Question.countDocuments({ category: new RegExp('^' + category.trim() + '$', 'i') });
  return { target: exam.totalQuestionsTarget, currentCount, examName: exam.title };
}

// Finds the single active combined "Test" (an Exam record with a non-empty
// sectionIds array). If admin has never created one, returns null and every
// caller falls back to the original "merge all active section exams"
// behaviour, so existing deployments are unaffected.
async function findActiveTest() {
  return Exam.findOne({ active: true, 'sectionIds.0': { $exists: true } }).populate('sectionIds');
}

// ---- Per-student question shuffling ----
// Anti-copying measure: two students sitting side by side and taking the
// same test at the same time must not see the questions in the same order,
// even though both are drawn from the exact same question set. The shuffle
// is seeded from the student's own id (+ category), so:
//   - it's different for every student (order looks unrelated to a neighbour)
//   - it's the *same* every time that one student reloads/re-fetches during
//     their own attempt (no re-shuffling mid-exam, which would be confusing
//     and would break "answered" tracking by index)
// Category blocks themselves are kept in place (only the questions *within*
// each category are reordered), so the section tabs / "(3-8)" ranges in the
// student dashboard keep working exactly as before.

// djb2-style string hash -> 32-bit unsigned int, used as a PRNG seed.
function hashSeed(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash >>> 0;
}

// mulberry32 — small, fast, deterministic PRNG from a numeric seed.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic Fisher–Yates shuffle, seeded by `seedStr`.
function seededShuffle(arr, seedStr) {
  const rand = mulberry32(hashSeed(seedStr));
  const result = arr.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Re-orders `questions` per student: category blocks stay where they were
// first seen, but the questions inside each block are shuffled using a seed
// derived from this student's id + that category name. If there's no
// logged-in student on the request (shouldn't normally happen — this route
// is behind studentAuth), the original order is returned untouched.
function shuffleForStudent(questions, studentId) {
  if (!studentId) return questions;

  const order = [];
  const groups = new Map();
  questions.forEach((q) => {
    const cat = q.category || '';
    if (!groups.has(cat)) { groups.set(cat, []); order.push(cat); }
    groups.get(cat).push(q);
  });

  const shuffled = [];
  order.forEach((cat) => {
    const seed = `${studentId}:${cat}`;
    shuffled.push(...seededShuffle(groups.get(cat), seed));
  });
  return shuffled;
}

// ---- Per-student OPTION shuffling ----
// Same idea as the question shuffle above, one level down: each student sees
// a question's options (A/B/C/D) in their own order, so a neighbour can't
// copy "the answer is C". Seeded from student id + question id, so it stays
// identical across reloads for that student. `correctOption` is remapped to
// the new position, so scoring (which compares the answer index against
// correctOption) keeps working unchanged.
// Rules:
//  - "All of the above" / "None of these" style options stay exactly where
//    they were (usually last); only the OTHER options are shuffled around them.
//  - If an option refers to others by letter ("Both A and B", "Option C"),
//    the question is left in its original order, since shuffling would
//    change its meaning.
const PINNED_OPTION_RE = /\b(all|none|both|neither)\b.*\b(above|these|following)\b/i;
const LETTER_REF_RE = /\b(both|either|only)?\s*\(?[A-D]\)?\s*(and|&|,|or)\s*\(?[A-D]\)?(?![a-z])|\boption\s*\(?[A-Da-d]\)?\b/;

function shuffleOptions(question, studentId) {
  const q = typeof question.toObject === 'function' ? question.toObject() : { ...question };
  const opts = Array.isArray(q.options) ? q.options : [];
  if (!studentId || opts.length < 2) return q;
  if (opts.some((o) => LETTER_REF_RE.test(String(o)))) return q;

  // order[newPos] = oldIndex. Pinned options keep their slot.
  const pinnedIdx = new Set();
  opts.forEach((o, i) => { if (PINNED_OPTION_RE.test(String(o))) pinnedIdx.add(i); });
  const freeIdx = opts.map((_, i) => i).filter((i) => !pinnedIdx.has(i));
  if (freeIdx.length < 2) return q;

  const rand = mulberry32(hashSeed(`${studentId}:${q._id}:options`));
  const shuffledFree = freeIdx.slice();
  for (let i = shuffledFree.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffledFree[i], shuffledFree[j]] = [shuffledFree[j], shuffledFree[i]];
  }

  const order = [];
  let f = 0;
  for (let pos = 0; pos < opts.length; pos++) {
    order.push(pinnedIdx.has(pos) ? pos : shuffledFree[f++]);
  }
  q.options = order.map((i) => opts[i]);
  q.correctOption = order.indexOf(Number(q.correctOption));
  return q;
}

function prepareForStudent(questions, studentId) {
  return shuffleForStudent(questions, studentId).map((q) => shuffleOptions(q, studentId));
}

// GET /api/questions — public/student facing, used by dashboard.html to load the exam
exports.listActiveQuestions = async (req, res) => {
  // A candidate who has already completed Round 1 must never be able to load
  // the paper again (e.g. via the browser Back button or a still-valid
  // token) and start the exam a second time.
  const studentIdForCheck = req.student && req.student.id;
  if (studentIdForCheck) {
    const finished = await ExamAssignment.exists({ student: studentIdForCheck, round: 1, status: 'Completed' });
    if (finished) {
      return res.status(409).json({ message: 'You have already completed this exam. It cannot be started again.' });
    }
  }

  // Start/entry window, enforced here too: the paper can only be loaded from
  // the scheduled start time (small tolerance for network delay) until the
  // late-entry cut-off. A token obtained inside the login window must not
  // let someone open the paper before the exam starts, or after entry closed.
  if (studentIdForCheck) {
    const current = await ExamAssignment.findOne({ student: studentIdForCheck, round: 1, status: 'InProgress' })
      .sort({ startedAt: -1 })
      .populate('exam', 'startTime');
    const exam = current && current.exam;
    if (exam && exam.startTime) {
      const startMs = new Date(exam.startTime).getTime();
      if (Date.now() < startMs - START_TOLERANCE_MS) {
        return res.status(403).json({
          message: 'The exam has not started yet. It will open automatically at the scheduled start time.'
        });
      }
    }
    const deadline = exam ? paperLoadDeadline(exam) : null;
    if (deadline && new Date() > deadline) {
      return res.status(403).json({
        message: 'Exam entry is closed. The exam could only be opened until its scheduled start time.'
      });
    }
  }

  const questions = await Question.find({ active: true }).sort({ createdAt: 1 });
  const exams = await Exam.find({}, 'title active sectionIds');

  const activeTest = await findActiveTest();
  const studentId = req.student && req.student.id;

  if (activeTest) {
    // A named Test is active — only show categories belonging to its
    // selected sections, regardless of what else is marked Active.
    const allowedCategories = new Set(
      activeTest.sectionIds.map((s) => s.title.trim().toLowerCase())
    );
    const visible = questions.filter((q) => allowedCategories.has((q.category || '').trim().toLowerCase()));
    return res.json(prepareForStudent(visible, studentId));
  }

  // No Test configured — original behaviour: only exclude a question if its
  // category matches a configured exam that is explicitly Inactive.
  // Categories with no matching exam record at all are left untouched, so
  // default/legacy question banks keep working. Combined Test records
  // themselves (sectionIds.length > 0) never match a real category, so they
  // never accidentally hide anything here.
  const inactiveCategories = new Set(
    exams.filter((e) => !e.active && (!e.sectionIds || e.sectionIds.length === 0)).map((e) => e.title.trim().toLowerCase())
  );
  const visible = questions.filter((q) => !inactiveCategories.has((q.category || '').trim().toLowerCase()));

  res.json(prepareForStudent(visible, studentId));
};

// GET /api/admin/questions — full bank for the admin question-bank UI
exports.listAllQuestions = async (req, res) => {
  const questions = await Question.find().sort({ createdAt: 1 });
  res.json(questions);
};

// POST /api/admin/questions
exports.createQuestion = async (req, res) => {
  try {
    const { category, text, options, correctOption } = req.body;
    if (!category || !text || !Array.isArray(options) || options.length < 2 || correctOption === undefined) {
      return res.status(400).json({ message: 'category, text, options[] and correctOption are required.' });
    }

    const limit = await getCategoryLimit(category);
    if (limit && limit.currentCount >= limit.target) {
      return res.status(409).json({
        message: `Cannot add more questions — "${limit.examName}" already has its target of ${limit.target} questions (currently ${limit.currentCount}).`
      });
    }

    const question = await Question.create({ category, text, options, correctOption });
    res.status(201).json(question);
  } catch (err) {
    res.status(500).json({ message: 'Could not create question.' });
  }
};

// PUT /api/admin/questions/:id
exports.updateQuestion = async (req, res) => {
  try {
    const existing = await Question.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Question not found.' });

    if (req.body.category && req.body.category.toLowerCase() !== existing.category.toLowerCase()) {
      const limit = await getCategoryLimit(req.body.category);
      if (limit && limit.currentCount >= limit.target) {
        return res.status(409).json({
          message: `Cannot move this question into "${limit.examName}" — it already has its target of ${limit.target} questions (currently ${limit.currentCount}).`
        });
      }
    }

    const question = await Question.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(question);
  } catch (err) {
    res.status(500).json({ message: 'Could not update question.' });
  }
};

// DELETE /api/admin/questions/:id
exports.deleteQuestion = async (req, res) => {
  const question = await Question.findByIdAndDelete(req.params.id);
  if (!question) return res.status(404).json({ message: 'Question not found.' });
  res.json({ message: 'Question deleted.' });
};

// POST /api/admin/questions/bulk — used for the "seed default 20 questions" behaviour
exports.bulkCreateQuestions = async (req, res) => {
  try {
    const items = Array.isArray(req.body.questions) ? req.body.questions : [];
    const existingTexts = new Set((await Question.find({}, 'text')).map(q => q.text.trim()));
    const toInsert = items.filter(q => q.text && !existingTexts.has(q.text.trim()));
    const inserted = toInsert.length ? await Question.insertMany(toInsert) : [];
    res.status(201).json({ inserted: inserted.length });
  } catch (err) {
    res.status(500).json({ message: 'Bulk insert failed.' });
  }
};