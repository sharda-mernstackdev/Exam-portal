const jwt = require('jsonwebtoken');
const Student = require('../models/Student');
const Exam = require('../models/Exam');
const ExamAssignment = require('../models/ExamAssignment');
const { sendExamInvitationEmail } = require('../utils/mailer');

const NAME_RE = /^[a-zA-Z\s]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^[0-9]{10}$/;

function signStudentToken(student) {
  return jwt.sign(
    { id: student._id, email: student.email, name: student.fullName, role: 'student' },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '6h' }
  );
}

function generateAccessCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// Registration always closes at 12:00 AM (midnight) on the exam's own day —
// no matter what time the exam itself starts. E.g. an exam on 30 Sep at
// 1:30 PM stops accepting registrations the moment 30 Sep begins (i.e. the
// last valid moment to register is 29 Sep 11:59:59 PM). This is fixed to
// India time (IST, UTC+5:30 — no DST) since that's this portal's audience,
// so it doesn't drift with the server's own timezone. Returns null for a
// Test with no scheduled startTime (an always-open test has no cut-off).
const IST_OFFSET_MS = 5.5 * 60 * 60000;
function registrationClosesAt(exam) {
  if (!exam.startTime) return null;
  const start = new Date(exam.startTime);
  // Shift the start instant into IST wall-clock, take that calendar day's
  // midnight, then shift back to a real UTC instant — this is the actual
  // moment "12:00 AM IST on the exam's date" occurs, regardless of the
  // server's own local timezone.
  const istWallClock = new Date(start.getTime() + IST_OFFSET_MS);
  const istMidnightUTC = Date.UTC(
    istWallClock.getUTCFullYear(), istWallClock.getUTCMonth(), istWallClock.getUTCDate(), 0, 0, 0
  );
  return new Date(istMidnightUTC - IST_OFFSET_MS);
}
function isRegistrationOpen(exam) {
  const closesAt = registrationClosesAt(exam);
  return !closesAt || new Date() < closesAt;
}

// GET /api/exams/current-registration — used by the root URL so admin can
// share just the bare domain with students; auto-picks the exam currently
// open for registration (prefers one whose window hasn't ended yet).
exports.getCurrentRegistrationExam = async (req, res) => {
  const now = new Date();
  // Only a combined Test (sectionIds present) is something a student
  // registers/logs in for — a raw question-set section (Aptitude,
  // Reasoning, ...) is never a registration target on its own.
  const testFilter = { active: true, 'sectionIds.0': { $exists: true } };

  // Prefer a Test that's still actually open for registration (i.e. before
  // midnight IST on its own exam day). Falling back to "exam hasn't ended
  // yet" (even if registration already closed) or finally to any active
  // Test keeps the root URL working the way it always has for admins
  // previewing things, while candidates land on the right (possibly
  // "closed") exam by default.
  const candidates = await Exam.find({ ...testFilter, endTime: { $gte: now } }).sort({ createdAt: -1 });
  let exam = candidates.find((e) => isRegistrationOpen(e)) || candidates[0];
  if (!exam) exam = await Exam.findOne(testFilter).sort({ createdAt: -1 });
  if (!exam) return res.status(404).json({ message: 'No exam is currently open for registration.' });
  res.json({ id: exam._id, title: exam.title });
};

// GET /api/exams/:examId/public — minimal exam info for the registration page
// (name/date/time only — never exposes the question bank or other candidates).
exports.getPublicExamInfo = async (req, res) => {
  const exam = await Exam.findById(req.params.examId);
  if (!exam || !exam.active) return res.status(404).json({ message: 'This exam is not available for registration.' });
  res.json({
    id: exam._id,
    title: exam.title,
    examDate: exam.examDate,
    startTime: exam.startTime,
    endTime: exam.endTime,
    loginWindowMinutes: exam.loginWindowMinutes,
    instructions: exam.instructions,
    registrationOpen: isRegistrationOpen(exam),
    registrationClosesAt: registrationClosesAt(exam)
  });
};

// POST /api/exams/:examId/register — public registration form submission.
// Creates/reuses the Student record, generates a per-exam access code, and
// emails the invitation with the scheduled window + exam-access link.
exports.registerForExam = async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.examId);
    if (!exam || !exam.active) {
      return res.status(404).json({ message: 'This exam is not available for registration.' });
    }

    // ---- Registration cut-off (12:00 AM on the exam's own day) ----
    // This is the real security boundary — never trust the frontend to have
    // hidden the form in time. A student hitting this endpoint directly
    // after the cut-off must still be rejected here.
    if (!isRegistrationOpen(exam)) {
      const closesAt = registrationClosesAt(exam);
      return res.status(403).json({
        message: `Registration for this exam closed at 12:00 AM on the exam day (${closesAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}). Please contact the administrator.`
      });
    }

    const fullName = (req.body.fullName || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const phone = (req.body.phone || '').trim();

    if (!fullName || !NAME_RE.test(fullName)) {
      return res.status(400).json({ message: 'Please enter your full name (letters and spaces only).' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ message: 'Please enter a valid email address.' });
    }
    if (!MOBILE_RE.test(phone)) {
      return res.status(400).json({ message: 'Please enter a valid 10-digit mobile number.' });
    }

    let student = await Student.findOne({ email });
    if (!student) {
      student = await Student.create({ fullName, email, phone });
    } else {
      student.fullName = fullName;
      student.phone = phone;
      await student.save();
    }

    let assignment = await ExamAssignment.findOne({ student: student._id, exam: exam._id });
    if (assignment) {
      return res.status(409).json({ message: 'You are already registered for this exam. Please check your email for the invitation.' });
    }

    assignment = await ExamAssignment.create({
      student: student._id,
      exam: exam._id,
      round: 1,
      accessCode: generateAccessCode(),
      status: 'Registered'
    });

    const emailResult = await sendExamInvitationEmail(student, exam, assignment);
    assignment.status = 'InvitationSent';
    assignment.invitationSentAt = new Date();
    await assignment.save();

    res.status(201).json({ message: 'Registration successful. Please check your email for the exam invitation.', emailSent: !!emailResult.sent });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error during registration.' });
  }
};

// POST /api/exams/:examId/access — verifies email + access code + the
// scheduled login window, then issues a student session token. This is the
// real security boundary: time-window and code checks all happen here,
// never trusted from the frontend.
exports.verifyExamAccess = async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.examId);
    if (!exam) return res.status(404).json({ message: 'Exam not found.' });

    const email = (req.body.email || '').trim().toLowerCase();
    const accessCode = (req.body.accessCode || '').trim();
    if (!EMAIL_RE.test(email) || !accessCode) {
      return res.status(400).json({ message: 'Email and access code are required.' });
    }

    const student = await Student.findOne({ email });
    if (!student) return res.status(404).json({ message: 'No registration found for this email.' });

    const assignment = await ExamAssignment.findOne({ student: student._id, exam: exam._id });
    if (!assignment) return res.status(404).json({ message: 'No registration found for this email on this exam.' });

    if (assignment.accessCode.toUpperCase() !== accessCode.toUpperCase()) {
      return res.status(401).json({ message: 'Incorrect access code. Please check your invitation email.' });
    }

    if (assignment.status === 'Completed') {
      return res.status(409).json({ message: 'You have already completed this exam.' });
    }

    // ---- Time window enforcement ----
    const now = new Date();
    if (exam.startTime) {
      const windowStart = new Date(new Date(exam.startTime).getTime() - (exam.loginWindowMinutes || 5) * 60000);
      const alreadyStarted = assignment.status === 'InProgress';

      if (!alreadyStarted && now < windowStart) {
        return res.status(403).json({
          message: `The login window has not opened yet. You may log in from ${windowStart.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}.`
        });
      }
      if (!alreadyStarted && now > new Date(exam.startTime)) {
        return res.status(403).json({
          message: 'Exam access time has expired. You were required to start the examination before the scheduled start time.'
        });
      }
      if (exam.endTime && now > new Date(exam.endTime) && !alreadyStarted) {
        return res.status(403).json({ message: 'This exam has already ended.' });
      }
    }

    if (assignment.status !== 'InProgress') {
      assignment.status = 'InProgress';
      assignment.startedAt = assignment.startedAt || new Date();
      await assignment.save();
    }

    const token = signStudentToken(student);
    res.json({
      token,
      student: { id: student._id, fullName: student.fullName, email: student.email, phone: student.phone },
      exam: { id: exam._id, title: exam.title, round: assignment.round }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error during exam access verification.' });
  }
};

// GET /api/admin/exams/:examId/assignments — registration/attempt tracking
// for the admin dashboard.
exports.listAssignmentsForExam = async (req, res) => {
  const assignments = await ExamAssignment.find({ exam: req.params.examId })
    .populate('student', 'fullName email phone')
    .sort({ createdAt: -1 });
  res.json(assignments);
};