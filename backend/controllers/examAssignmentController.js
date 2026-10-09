const jwt = require('jsonwebtoken');
const Student = require('../models/Student');
const Exam = require('../models/Exam');
const ExamAssignment = require('../models/ExamAssignment');
const Settings = require('../models/Settings');
const { sendExamInvitationEmail } = require('../utils/mailer');
const { startSingleSession, isLoggedInElsewhere } = require('../utils/session');
const { isMobileRequest, MOBILE_BLOCK_MESSAGE } = require('../utils/device');
const { lateLoginDeadline } = require('../utils/examWindow');

const NAME_RE = /^[a-zA-Z\s]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^[0-9]{10}$/;

function signStudentToken(student, sid) {
  return jwt.sign(
    { id: student._id, email: student.email, name: student.fullName, role: 'student', sid },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '6h' }
  );
}

function generateAccessCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// ---- Registration window ----
// The admin sets the registration start and end time when creating the exam
// (registrationStartTime / registrationEndTime). Registration is open only
// between those two moments. Fallbacks, so older exams keep working:
//   - no start time  -> open from the moment the exam is created
//   - no end time    -> open until the exam's own start time
//   - neither, and no exam start time -> always open
const IST_OFFSET_MS = 5.5 * 60 * 60000;
function registrationOpensAt(exam) {
  return exam.registrationStartTime ? new Date(exam.registrationStartTime) : null;
}
function registrationClosesAt(exam) {
  if (exam.registrationEndTime) return new Date(exam.registrationEndTime);
  if (exam.startTime) return new Date(exam.startTime);
  return null;
}
function isRegistrationOpen(exam) {
  const now = new Date();
  const opensAt = registrationOpensAt(exam);
  const closesAt = registrationClosesAt(exam);
  if (opensAt && now < opensAt) return false;
  if (closesAt && now >= closesAt) return false;
  return true;
}
function fmtIST(d) {
  return new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
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
  // the admin's registration end time). Falling back to "exam hasn't ended
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
    examMode: exam.examMode || 'campus',
    instructions: exam.instructions,
    // Server clock, so the instructions screen can count down to the exact
    // start time even if the candidate's own computer clock is off.
    serverTime: new Date().toISOString(),
    registrationOpen: isRegistrationOpen(exam),
    registrationOpensAt: registrationOpensAt(exam),
    registrationNotStarted: !!(registrationOpensAt(exam) && new Date() < registrationOpensAt(exam)),
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

    // ---- Registration window (set by the admin on the exam) ----
    // This is the real security boundary — never trust the frontend to have
    // hidden the form in time. A student hitting this endpoint directly
    // outside the window must still be rejected here.
    if (!isRegistrationOpen(exam)) {
      const opensAt = registrationOpensAt(exam);
      if (opensAt && new Date() < opensAt) {
        return res.status(403).json({
          message: `Registration for this exam has not started yet. It opens on ${fmtIST(opensAt)}.`
        });
      }
      const closesAt = registrationClosesAt(exam);
      return res.status(403).json({
        message: `Registration for this exam closed on ${fmtIST(closesAt)}. Please contact the administrator.`
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

    // ---- One registration per candidate per exam ----
    // A candidate who has already registered for this exam (same email, or
    // the same mobile number under any email) cannot register again — no
    // second invitation, no second access code. Checked BEFORE anything is
    // created or updated.
    let student = await Student.findOne({ email });
    if (student) {
      const existing = await ExamAssignment.findOne({ student: student._id, exam: exam._id });
      if (existing) {
        return res.status(409).json({
          message: 'This email is already registered for this exam. You cannot register again. Please use the exam link sent to your email.'
        });
      }
    }
    const samePhoneStudents = await Student.find({ phone }, '_id');
    if (samePhoneStudents.length) {
      const phoneUsed = await ExamAssignment.exists({
        exam: exam._id,
        student: { $in: samePhoneStudents.map((s) => s._id) }
      });
      if (phoneUsed) {
        return res.status(409).json({
          message: 'This mobile number is already registered for this exam. You cannot register again.'
        });
      }
    }

    if (!student) {
      student = await Student.create({ fullName, email, phone });
    } else {
      student.fullName = fullName;
      student.phone = phone;
      await student.save();
    }

    let assignment;
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

    // Only the access code the admin currently has set in Settings
    // (Candidate Access Code, Round 1) is accepted — the same code that is
    // printed in the invitation email and that the admin gives out directly.
    const portal = await Settings.findOne({ key: 'portal' }).lean();
    const currentCode = ((portal && portal.accessCode) || assignment.accessCode || '').toUpperCase();
    if (accessCode.toUpperCase() !== currentCode) {
      return res.status(401).json({ message: 'Incorrect access code. Please check your invitation email.' });
    }

    if (assignment.status === 'Completed') {
      return res.status(409).json({ message: 'You have already completed this exam.' });
    }

    // Laptop / desktop only — phones and tablets cannot start the exam.
    if (isMobileRequest(req)) {
      return res.status(403).json({ message: MOBILE_BLOCK_MESSAGE });
    }

    // ---- Time window enforcement ----
    const now = new Date();
    if (exam.startTime) {
      const windowStart = new Date(new Date(exam.startTime).getTime() - (exam.loginWindowMinutes || 5) * 60000);
      const alreadyStarted = assignment.status === 'InProgress';
      const deadline = lateLoginDeadline(exam);

      if (!alreadyStarted && now < windowStart) {
        return res.status(403).json({
          message: `The login window has not opened yet. You may log in from ${windowStart.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}.`
        });
      }
      // Login closes at the deadline from utils/examWindow.js (the exam start
      // time) — for EVERYONE, including a candidate who already opened the
      // link before (status InProgress). Nobody may sign in after this point.
      if (deadline && now > deadline) {
        return res.status(403).json({
          message: `Login is closed. Exam access was only available until ${deadline.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}.`
        });
      }
      if (exam.endTime && now > new Date(exam.endTime)) {
        return res.status(403).json({ message: 'This exam has already ended.' });
      }
    }

    // ---- One device at a time ----
    // If this candidate is already signed in (and active) on another
    // device, refuse this sign-in instead of logging the first one out.
    const deviceId = String(req.body.deviceId || '').slice(0, 64);
    if (isLoggedInElsewhere(student, deviceId)) {
      return res.status(409).json({
        message: 'You are already logged in on another device. Please continue the exam on that device. If it was closed, wait about one minute and try again.'
      });
    }

    if (assignment.status !== 'InProgress') {
      assignment.status = 'InProgress';
      assignment.startedAt = assignment.startedAt || new Date();
      await assignment.save();
    }

    // Fresh single-device session: signs out any other device this student
    // is currently logged in on (see utils/session.js).
    const sid = await startSingleSession(student, deviceId);
    const token = signStudentToken(student, sid);
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

// GET /api/admin/exams/today-registrations — how many candidates have
// registered so far for the exam(s) scheduled "today" (IST calendar day),
// so the admin can see, at a glance on the Executive Dashboard, whether
// enough people have signed up before registration closes. Only combined Tests (sectionIds present) are registration
// targets — a raw question-set section is never registered for directly.
exports.getTodayRegistrationStats = async (req, res) => {
  const now = new Date();
  const istWallClock = new Date(now.getTime() + IST_OFFSET_MS);
  const istMidnightUTC = Date.UTC(
    istWallClock.getUTCFullYear(), istWallClock.getUTCMonth(), istWallClock.getUTCDate(), 0, 0, 0
  );
  const todayStartUTC = new Date(istMidnightUTC - IST_OFFSET_MS);
  const todayEndUTC = new Date(todayStartUTC.getTime() + 24 * 60 * 60000);

  const todaysExams = await Exam.find({
    active: true,
    'sectionIds.0': { $exists: true },
    $or: [
      { startTime: { $gte: todayStartUTC, $lt: todayEndUTC } },
      { examDate: { $gte: todayStartUTC, $lt: todayEndUTC } }
    ]
  }).sort({ startTime: 1 });

  const exams = await Promise.all(
    todaysExams.map(async (exam) => {
      const registrationCount = await ExamAssignment.countDocuments({ exam: exam._id });
      return {
        examId: exam._id,
        title: exam.title,
        startTime: exam.startTime,
        registrationCount,
        registrationOpen: isRegistrationOpen(exam),
        registrationOpensAt: registrationOpensAt(exam),
        registrationClosesAt: registrationClosesAt(exam)
      };
    })
  );

  const totalRegistrations = exams.reduce((sum, e) => sum + e.registrationCount, 0);
  res.json({ exams, totalRegistrations });
};