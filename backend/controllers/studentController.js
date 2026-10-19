const Student = require('../models/Student');
const Submission = require('../models/Submission');
const SecondLevelResult = require('../models/SecondLevelResult');
const ExamAssignment = require('../models/ExamAssignment');
const ProctorLog = require('../models/ProctorLog');
const { scheduleRound2Mails, sendFinalMailsNow } = require('../utils/round2Manual');
const { isMailConfigured } = require('../utils/mailer');

// GET /api/admin/students — "Registered Students" tab in admin dashboard
exports.listStudents = async (req, res) => {
  const students = await Student.find({}, '-passwordHash').sort({ registeredAt: -1 }).lean();
  // The latest Round 1 registration of each student: tells whether they are
  // registered for a Round 1 exam and whether that exam is Online or Offline
  // (campus drive), plus the exam name.
  const r1Assignments = await ExamAssignment.find({ round: 1 }).sort({ updatedAt: -1 }).populate('exam', 'title').lean();
  const r1ByStudent = new Map();
  r1Assignments.forEach((a) => {
    const key = String(a.student);
    if (!r1ByStudent.has(key)) r1ByStudent.set(key, a); // newest first
  });
  res.json(students.map((s) => {
    const a = r1ByStudent.get(String(s._id));
    return {
      ...s,
      round1Registered: !!a,
      entryMode: a ? (a.entryMode === 'campus' ? 'campus' : 'online') : '',
      examTitle: a && a.exam ? a.exam.title : ''
    };
  }));
};

// DELETE /api/admin/students — clear all registered students (matches old
// localStorage.removeItem('registeredStudents') admin action)
exports.clearStudents = async (req, res) => {
  await Student.deleteMany({});
  res.json({ message: 'All registered students cleared.' });
};

// DELETE /api/admin/students/:id — removes ONE candidate together with
// everything that belongs to that candidate (exam registrations, Round 1 and
// Round 2 results, proctoring logs), so nothing is left behind in the lists
// and the same person can register again from scratch.
exports.deleteStudent = async (req, res) => {
  const student = await Student.findByIdAndDelete(req.params.id);
  if (!student) return res.status(404).json({ message: 'Student not found.' });
  await Promise.all([
    ExamAssignment.deleteMany({ student: student._id }),
    Submission.deleteMany({ student: student._id }),
    SecondLevelResult.deleteMany({ student: student._id }),
    ProctorLog.deleteMany({ student: student._id })
  ]);
  res.json({ message: 'Student deleted.' });
};

// GET /api/admin/candidate-journey — one row per candidate covering the
// full two-round journey (Round 1 result, Round 2 eligibility/result, final
// status), for the admin Results Report tab.
exports.candidateJourney = async (req, res) => {
  const students = await Student.find({}, '-passwordHash');
  const submissions = await Submission.find().sort({ createdAt: -1 });
  const secondResults = await SecondLevelResult.find().sort({ createdAt: -1 });

  const latestSubmissionByStudent = {};
  submissions.forEach((s) => {
    const key = String(s.student);
    if (!latestSubmissionByStudent[key]) latestSubmissionByStudent[key] = s; // already sorted newest-first
  });
  const latestR2ByStudent = {};
  secondResults.forEach((r) => {
    const key = String(r.student);
    if (!latestR2ByStudent[key]) latestR2ByStudent[key] = r;
  });

  // Which exam each candidate took Round 1 in, for the per-exam mail buttons
  // on the Results Report page.
  const r1Assignments = await ExamAssignment.find({ round: 1 }).sort({ updatedAt: -1 }).populate('exam', 'title examMode').lean();
  const assignmentByStudent = {};
  r1Assignments.forEach((a) => {
    const key = String(a.student);
    if (!assignmentByStudent[key]) assignmentByStudent[key] = a; // newest first
  });

  const rows = students.map((student) => {
    const r1 = latestSubmissionByStudent[String(student._id)];
    const asg = assignmentByStudent[String(student._id)];
    const r2 = latestR2ByStudent[String(student._id)];

    let finalStatus = 'PENDING';
    if (student.roundProgress.r1 === 'FAIL') finalStatus = 'FAILED_ROUND1';
    else if (student.roundProgress.r1 === 'PASS' && student.roundProgress.r2 === 'PASS') finalStatus = 'CLEARED_BOTH';
    else if (student.roundProgress.r1 === 'PASS' && student.roundProgress.r2 === 'FAIL') finalStatus = 'FAILED_ROUND2';
    else if (student.roundProgress.r1 === 'PASS' && student.round2Eligible) finalStatus = 'ROUND2_PENDING';

    return {
      studentId: student._id,
      name: student.fullName,
      email: student.email,
      phone: student.phone || '',
      round1: r1 ? { score: r1.score, total: r1.totalQuestions, percentage: r1.percentage, status: r1.round1Status, submittedOn: r1.createdAt } : null,
      examId: asg && asg.exam ? asg.exam._id : null,
      examTitle: asg && asg.exam ? asg.exam.title : '',
      examMode: asg && asg.exam ? asg.exam.examMode : '',
      entryMode: asg ? asg.entryMode : '',
      round2Eligible: student.round2Eligible,
      round2EmailSent: !!student.round2EmailSentAt,
      round2EmailDueAt: student.round2EmailDueAt || null,
      round2: r2 ? { score: r2.totalScore, status: r2.round2Status, submittedOn: r2.createdAt } : null,
      round2Completed: student.round2Completed,
      finalStatus,
      finalEmailSent: !!student.finalEmailSentAt
    };
  });

  res.json(rows);
};

function mailNotSetUp(res) {
  return res.status(503).json({ message: 'Email is not set up on the server (SMTP settings are missing), so no mail can be sent.' });
}

// POST /api/admin/round2/send-emails - "Send Round 2 mail" buttons.
// Body (all optional): { examId, studentIds }. Schedules the Round 2 mail,
// 10 minutes from now, for every candidate in that scope who passed Round 1 and
// has not been mailed or scheduled yet. Replies { scheduled, sendAt, delayMinutes }.
exports.sendRound2Emails = async (req, res) => {
  try {
    if (!isMailConfigured()) return mailNotSetUp(res);
    const { examId, studentIds } = req.body || {};
    res.json(await scheduleRound2Mails({ examId, studentIds }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    res.status(500).json({ message: 'Could not schedule the Round 2 mails.' });
  }
};

// POST /api/admin/final/send-emails - "Send HR round mail" buttons: sends right
// away to candidates who passed Round 2 and have not been mailed yet.
exports.sendFinalEmails = async (req, res) => {
  try {
    if (!isMailConfigured()) return mailNotSetUp(res);
    const { examId, studentIds } = req.body || {};
    res.json(await sendFinalMailsNow({ examId, studentIds }));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ message: err.message });
    console.error(err);
    res.status(500).json({ message: 'Could not send the HR round mails.' });
  }
};