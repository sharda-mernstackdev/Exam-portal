const Submission = require('../models/Submission');
const Student = require('../models/Student');
const Settings = require('../models/Settings');
const ExamAssignment = require('../models/ExamAssignment');
const { computeRound2EmailDueAt } = require('../utils/round2Scheduler');
const { getVisibleQuestions, shuffleOptions } = require('./questionController');
const { logViolation } = require('../utils/violation');

// POST /api/submissions — student submits round 1 (dashboard.html "Complete Exam")
//
// The browser is NOT trusted for scoring. It only tells us which questions
// (by id) it showed and which option position the candidate picked. The
// question text, options and the correct answer are always read from the
// database here, and the option order is re-derived with the same per-student
// shuffle the paper was served with. Anything the client sends about
// correctOption / question content is ignored, so a tampered page or an
// extension cannot award itself marks.
exports.createSubmission = async (req, res) => {
  let claimedAssignmentId = null;
  try {
    const { questions, userAnswers } = req.body;
    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ message: 'questions[] is required.' });
    }
    const studentId = String(req.student.id);

    // One attempt only, enforced atomically: the first submission flips the
    // Round 1 assignment InProgress -> Completed in a single database
    // operation, so two simultaneous submissions (double click, replayed
    // request, second device) cannot both be accepted.
    const claimed = await ExamAssignment.findOneAndUpdate(
      { student: req.student.id, round: 1, status: 'InProgress' },
      { $set: { status: 'Completed', completedAt: new Date() } },
      { new: true }
    );
    if (claimed) {
      claimedAssignmentId = claimed._id;
    } else if (await ExamAssignment.exists({ student: req.student.id, round: 1 })) {
      // An assignment exists but it is not InProgress: already completed (or
      // never started through the exam link).
      return res.status(409).json({ message: 'You have already completed this exam. Multiple attempts are not allowed.' });
    }

    // ---- Rebuild the paper from the database ----
    const visible = await getVisibleQuestions();
    const byId = new Map(visible.map((q) => [String(q._id), q]));

    const seen = new Set();
    const rows = []; // { q (student's view, server data), answer }
    let unknown = 0;
    let duplicate = 0;
    let badAnswer = 0;
    questions.forEach((cq, idx) => {
      const id = cq && (cq._id || cq.id);
      const dbq = id ? byId.get(String(id)) : null;
      if (!dbq) { unknown++; return; }
      if (seen.has(String(dbq._id))) { duplicate++; return; }
      seen.add(String(dbq._id));
      const view = shuffleOptions(dbq, studentId); // student's option order + matching correctOption
      let answer = userAnswers ? userAnswers[idx] : undefined;
      if (answer !== undefined) {
        const n = Number(answer);
        if (Number.isInteger(n) && n >= 0 && n < view.options.length) answer = n;
        else { answer = undefined; badAnswer++; }
      }
      rows.push({ q: view, answer });
    });
    // Questions the paper had but the client left out count as unanswered.
    visible.forEach((dbq) => {
      if (!seen.has(String(dbq._id))) rows.push({ q: shuffleOptions(dbq, studentId), answer: undefined });
    });

    if (rows.length === 0) {
      if (claimedAssignmentId) {
        await ExamAssignment.updateOne({ _id: claimedAssignmentId }, { $set: { status: 'InProgress' }, $unset: { completedAt: 1 } });
        claimedAssignmentId = null;
      }
      return res.status(400).json({ message: 'No valid questions were submitted.' });
    }

    if (unknown || duplicate || badAnswer || questions.length !== visible.length) {
      await logViolation(
        req.student.id,
        'server_submission_mismatch',
        `Round 1 submission differs from the served paper: sent ${questions.length}, paper ${visible.length}, unknown ids ${unknown}, duplicates ${duplicate}, invalid answers ${badAnswer}.`,
        'round1-submit'
      );
    }

    // Client-claimed content, if present, must agree with the database copy.
    let contentMismatch = 0;
    questions.forEach((cq) => {
      const dbq = cq && byId.get(String(cq._id || cq.id));
      if (!dbq) return;
      const view = shuffleOptions(dbq, studentId);
      if (cq.correctOption !== undefined && Number(cq.correctOption) !== Number(view.correctOption)) contentMismatch++;
      else if (String(cq.text || '') !== String(view.text)) contentMismatch++;
    });
    if (contentMismatch) {
      await logViolation(
        req.student.id,
        'server_question_tampered',
        `${contentMismatch} question(s) in the Round 1 submission had text/correct answer different from the server copy (ignored, server copy used).`,
        'round1-submit'
      );
    }

    let score = 0;
    const finalQuestions = rows.map((r) => r.q);
    const finalAnswers = {};
    rows.forEach((r, i) => {
      if (r.answer !== undefined) {
        finalAnswers[i] = r.answer;
        if (r.answer === Number(r.q.correctOption)) score++;
      }
    });
    const totalQuestions = finalQuestions.length;
    const percentage = Number(((score / totalQuestions) * 100).toFixed(1));

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
      totalQuestions,
      percentage,
      questions: finalQuestions.map(q => ({
        text: q.text,
        section: q.category,
        options: q.options,
        correctOption: q.correctOption
      })),
      userAnswers: finalAnswers,
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

    // (The Round 1 assignment was already marked Completed atomically at the
    // top of this handler.)

    res.status(201).json({ submission, round1Status, score, percentage, round2EmailSent: false });
  } catch (err) {
    console.error(err);
    // The attempt was claimed but nothing was saved: give it back so the
    // candidate is not locked out by a server error.
    if (claimedAssignmentId) {
      try {
        const saved = await Submission.exists({ student: req.student.id, createdAt: { $gte: new Date(Date.now() - 60000) } });
        if (!saved) {
          await ExamAssignment.updateOne({ _id: claimedAssignmentId }, { $set: { status: 'InProgress' }, $unset: { completedAt: 1 } });
        }
      } catch (e) { /* ignore */ }
    }
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