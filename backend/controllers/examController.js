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

// ---- Offline exam (campus drive) ----
// An offline exam (examMode 'campus') gets its web address from its name:
// "Raisoni Exam" -> "raisoniexam" -> www.yoursite.com/raisoniexam. The address
// must be unique, and must not clash with a page the portal already has. The
// access code is created automatically (and kept when the exam is edited).
// Online exams keep both fields empty.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode() {
  let c = '';
  for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

const RESERVED_SLUGS = new Set([
  'api', 'login', 'admin', 'adminlogin', 'admindashboard', 'round2login', 'register', 'examaccess',
  'instructions', 'dashboard', 'secondlevelexam', 'summary', 'privacypolicy', 'googlecallback',
  'assets', 'static', 'favicon', 'robots', 'index'
]);

function makeSlug(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function normalizeOffline(body, examId) {
  let mode = body.examMode;
  let title = body.title;
  let existing = null;
  if (examId) {
    existing = await Exam.findById(examId).lean();
    if (mode === undefined && existing) mode = existing.examMode;
    if (title === undefined && existing) title = existing.title;
  }
  if (mode !== 'campus') {
    // Online exam: no offline address / code.
    return { body: { ...body, slug: '', campusAccessCode: '' } };
  }
  // A section (question set) is not an exam people sit; only a Test gets an address.
  const isTest = Array.isArray(body.sectionIds) ? body.sectionIds.length > 0 : !!(existing && existing.sectionIds && existing.sectionIds.length);
  if (!isTest) return { body };

  const slug = makeSlug(title);
  if (!slug) return { error: 'Please give the exam a name made of letters or numbers. The exam web address is made from the name.' };
  if (RESERVED_SLUGS.has(slug)) return { error: `The name "${title}" cannot be used because "${slug}" is a reserved web address. Please choose another exam name.` };
  const clash = await Exam.findOne({ slug, ...(examId ? { _id: { $ne: examId } } : {}) }).lean();
  if (clash) return { error: `Another exam already uses the web address "/${slug}". Please choose a different exam name.` };

  let code = String(body.campusAccessCode || (existing && existing.campusAccessCode) || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!code) code = randomCode();
  return { body: { ...body, slug, campusAccessCode: code } };
}

// ---- Round 1 exams (examList) ----
exports.listExams = async (req, res) => {
  res.json(await Exam.find().sort({ createdAt: -1 }));
};

exports.createExam = async (req, res) => {
  const result = await normalizeOffline(req.body, null);
  if (result.error) return res.status(400).json({ message: result.error });
  const exam = await Exam.create(await withComputedTotals(result.body));
  res.status(201).json(exam);
};

exports.updateExam = async (req, res) => {
  const result = await normalizeOffline(req.body, req.params.id);
  if (result.error) return res.status(400).json({ message: result.error });
  const exam = await Exam.findByIdAndUpdate(req.params.id, await withComputedTotals(result.body), { new: true });
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