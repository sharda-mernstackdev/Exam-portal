const Question = require('../models/Question');
const Exam = require('../models/Exam');

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

// GET /api/questions — public/student facing, used by dashboard.html to load the exam
exports.listActiveQuestions = async (req, res) => {
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
    return res.json(shuffleForStudent(visible, studentId));
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

  res.json(shuffleForStudent(visible, studentId));
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