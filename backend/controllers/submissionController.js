const Submission = require('../models/Submission');
const Student = require('../models/Student');
const Settings = require('../models/Settings');
const { sendRound2InvitationEmail } = require('../utils/mailer');

// POST /api/submissions — student submits round 1 (dashboard.html "Complete Exam")
exports.createSubmission = async (req, res) => {
  try {
    const { questions, userAnswers } = req.body;
    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ message: 'questions[] is required.' });
    }

    let score = 0;
    questions.forEach((q, idx) => {
      const answer = userAnswers ? userAnswers[idx] : undefined;
      if (answer !== undefined && Number(answer) === Number(q.correctOption)) score++;
    });
    const percentage = Number(((score / questions.length) * 100).toFixed(1));

    const settingsDoc = await Settings.findOne({ key: 'portal' });
    const qualifyingPct = settingsDoc ? settingsDoc.qualifyingPct : 40;
    const round1Status = percentage >= qualifyingPct ? 'PASS' : 'FAIL';

    const student = await Student.findById(req.student.id);
    if (!student) return res.status(404).json({ message: 'Student record not found.' });

    const submission = await Submission.create({
      student: student._id,
      name: student.fullName,
      email: student.email,
      score,
      totalQuestions: questions.length,
      percentage,
      questions: questions.map(q => ({
        text: q.text,
        section: q.section || q.category,
        options: q.options,
        correctOption: q.correctOption
      })),
      userAnswers: userAnswers || {},
      round1Status
    });

    student.roundProgress.r1 = round1Status;

    // ---- Round 2 eligibility (server-side source of truth) ----
    // A FAIL always clears eligibility, even if a previous attempt had
    // passed — the most recent Round 1 attempt decides. A PASS sets
    // eligibility and triggers the invitation email exactly once (dedup'd
    // via round2EmailSentAt) so retaking/resubmitting Round 1 never spams
    // the candidate with repeat invitations.
    let round2EmailResult = null;
    if (round1Status === 'PASS') {
      student.round2Eligible = true;
      if (!student.round2EmailSentAt) {
        const settingsDoc2 = settingsDoc || (await Settings.findOne({ key: 'portal' }));
        const round2Code = settingsDoc2 && settingsDoc2.round2AccessCode;
        if (round2Code) {
          round2EmailResult = await sendRound2InvitationEmail(student, round2Code);
          student.round2EmailSentAt = new Date();
        }
      }
    } else {
      student.round2Eligible = false;
    }
    await student.save();

    res.status(201).json({ submission, round1Status, score, percentage, round2EmailSent: !!(round2EmailResult && round2EmailResult.sent) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not save submission.' });
  }
};

// GET /api/submissions/mine — used by summary.html to show the candidate's own result
exports.myLatestSubmission = async (req, res) => {
  const submission = await Submission.findOne({ student: req.student.id }).sort({ createdAt: -1 });
  if (!submission) return res.status(404).json({ message: 'No submission found.' });
  res.json(submission);
};

// GET /api/admin/submissions — admin dashboard results table
exports.listSubmissions = async (req, res) => {
  const submissions = await Submission.find().sort({ createdAt: -1 });
  res.json(submissions);
};

// GET /api/admin/round-progress
exports.roundProgress = async (req, res) => {
  const students = await Student.find({}, 'fullName email roundProgress');
  res.json(students);
};

// DELETE /api/admin/submissions — used by the admin "Clear Data" button
exports.clearSubmissions = async (req, res) => {
  await Submission.deleteMany({});
  res.json({ message: 'All round 1 submissions cleared.' });
};