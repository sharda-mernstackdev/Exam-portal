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

// GET /api/questions — public/student facing, used by dashboard.html to load the exam
exports.listActiveQuestions = async (req, res) => {
  const questions = await Question.find({ active: true }).sort({ createdAt: 1 });
  const exams = await Exam.find({}, 'title active sectionIds');

  const activeTest = await findActiveTest();

  if (activeTest) {
    // A named Test is active — only show categories belonging to its
    // selected sections, regardless of what else is marked Active.
    const allowedCategories = new Set(
      activeTest.sectionIds.map((s) => s.title.trim().toLowerCase())
    );
    const visible = questions.filter((q) => allowedCategories.has((q.category || '').trim().toLowerCase()));
    return res.json(visible);
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

  res.json(visible);
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