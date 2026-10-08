const Submission = require('../models/Submission');
const Student = require('../models/Student');
const Settings = require('../models/Settings');
const ExamAssignment = require('../models/ExamAssignment');
const { computeRound2EmailDueAt } = require('../utils/round2Scheduler');

// POST /api/submissions — student submits round 1 (dashboard.html "Complete Exam")
exports.createSubmission = async (req, res) => {
  try {
    const { questions, userAnswers } = req.body;
    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ message: 'questions[] is required.' });
    }

    // One attempt only: once this candidate's Round 1 is Completed, any
    // further submission (replayed request, second device, Back button) is
    // refused instead of creating a duplicate result.
    const alreadyDone = await ExamAssignment.exists({ student: req.student.id, round: 1, status: 'Completed' });
    if (alreadyDone) {
      return res.status(409).json({ message: 'You have already completed this exam. Multiple attempts are not allowed.' });
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
    // A FAIL clears eligibility. A PASS sets eligibility and schedules the
    // Round 2 invitation for 15 minutes after Round 1 ends (the background
    // scheduler in utils/round2Scheduler.js sends it, exactly once), so
    // candidates are not told the result the moment they submit.
    if (round1Status === 'PASS') {
      student.round2Eligible = true;
      if (!student.round2EmailSentAt) {
        const r1Assignment = await ExamAssignment.findOne({ student: student._id, round: 1 })
          .sort({ updatedAt: -1 })
          .populate('exam', 'endTime');
        student.round2EmailDueAt = computeRound2EmailDueAt(r1Assignment && r1Assignment.exam);
      }
    } else {
      student.round2Eligible = false;
    }
    await student.save();

    // If this student came in via a scheduled exam registration (round 1),
    // mark that assignment Completed so the timed-access flow blocks re-entry.
    await ExamAssignment.updateMany(
      { student: student._id, round: 1, status: 'InProgress' },
      { $set: { status: 'Completed', completedAt: new Date() } }
    );

    res.status(201).json({ submission, round1Status, score, percentage, round2EmailSent: false });
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