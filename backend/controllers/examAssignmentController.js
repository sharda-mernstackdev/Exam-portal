const jwt = require('jsonwebtoken');
const Student = require('../models/Student');
const Exam = require('../models/Exam');
const ExamAssignment = require('../models/ExamAssignment');
const Settings = require('../models/Settings');
const { sendExamInvitationEmail } = require('../utils/mailer');
const { startRoundSession } = require('../utils/session');
const { isMobileRequest, MOBILE_BLOCK_MESSAGE } = require('../utils/device');
const { lateLoginDeadline } = require('../utils/examWindow');
const { requireRegisteredGoogleEmail } = require('../utils/googleAuth');

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
  // Offline exams (they have their own web address) are never registration targets.
  const testFilter = { active: true, 'sectionIds.0': { $exists: true }, slug: { $in: ['', null] } };

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
    durationMinutes: exam.durationMinutes,
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
    if (exam.examMode === 'campus' && exam.slug) {
      return res.status(403).json({ message: 'This is an offline exam. Please open the exam web address given by the exam administrator and enter your details there.' });
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

    // Registration does NOT need a Google sign-in. The email owner is checked
    // later, when the exam link sent to that email is opened (verifyExamAccess
    // and round2Login).
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

    // ---- Email ownership check (Google Sign-In) ----
    // The exam link can be forwarded (WhatsApp, SMS, another person's Chrome).
    // So opening it is not enough: the person must also be signed in to the
    // Google account of the REGISTERED email. The email comes from Google's
    // verified token, never from the link or the form.
    // HARD check: always required, and refused when it is not configured.
    const emailCheck = await requireRegisteredGoogleEmail(req.body.googleToken, student.email, 'exam');
    if (emailCheck) return res.status(emailCheck.status).json(emailCheck.body);

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

    // ---- One device at a time (Round 1 session) ----
    // Atomic: if this candidate already has a live Round 1 session on another
    // device, this sign-in is refused instead of logging the first one out.
    // Two devices signing in at the same moment cannot both succeed.
    const deviceId = String(req.body.deviceId || '').slice(0, 64);
    const started = await startRoundSession(Student, student._id, 1, deviceId);
    if (!started) {
      return res.status(409).json({
        message: 'You are already logged in on another device. Please continue the exam on that device. If it was closed, wait about one minute and try again.'
      });
    }

    if (assignment.status !== 'InProgress') {
      assignment.status = 'InProgress';
      assignment.startedAt = assignment.startedAt || new Date();
      await assignment.save();
    }

    const token = signStudentToken(student, started.sid);
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

// ================= OFFLINE EXAM (campus drive) =================
// The exam has its own web address made from its name (www.site.com/raisoniexam).
// The candidate enters name, email, mobile and the access code the admin tells
// them. No registration, no emailed link.
//
// Timing: the exam starts for each candidate OFFLINE_START_DELAY_MINUTES after
// they pressed Submit (10:02 -> starts 10:04; 10:03 -> starts 10:05), and runs
// for the exam's full duration (all question sets added together). The
// instructions page counts down to that personal start time.
const OFFLINE_START_DELAY_MINUTES = 2;

function newAssignmentCode() {
  return generateAccessCode() + generateAccessCode().slice(0, 2);
}

async function findOfflineExam(slug) {
  const clean = String(slug || '').trim().toLowerCase();
  if (!clean) return null;
  return Exam.findOne({ slug: clean, examMode: 'campus', active: true });
}

// GET /api/campus/:slug - what the entry page needs (never the code).
exports.offlineExamInfo = async (req, res) => {
  const exam = await findOfflineExam(req.params.slug);
  if (!exam) return res.status(404).json({ message: 'This exam web address is not valid. Please check the address given by the exam administrator.' });
  res.json({ title: exam.title, instructions: exam.instructions || '' });
};

// POST /api/campus/:slug/entry
exports.campusEntry = async (req, res) => {
  try {
    const exam = await findOfflineExam(req.params.slug);
    if (!exam) return res.status(404).json({ message: 'This exam web address is not valid. Please check the address given by the exam administrator.' });

    const fullName = String(req.body.fullName || '').trim().replace(/\s+/g, ' ');
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = String(req.body.phone || '').trim();
    const accessCode = String(req.body.accessCode || '').trim().toUpperCase().replace(/\s+/g, '');

    if (!fullName || !NAME_RE.test(fullName)) {
      return res.status(400).json({ message: 'Please enter your full name (letters and spaces only).' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ message: 'Please enter a valid email address.' });
    }
    if (!MOBILE_RE.test(phone)) {
      return res.status(400).json({ message: 'Please enter a valid 10-digit mobile number.' });
    }
    if (!accessCode) {
      return res.status(400).json({ message: 'Please enter the access code given by the exam administrator.' });
    }
    if (!exam.campusAccessCode || accessCode !== String(exam.campusAccessCode).toUpperCase()) {
      return res.status(401).json({ message: 'Incorrect access code. Please check the code given by the exam administrator.' });
    }

    // Laptop / desktop only.
    if (isMobileRequest(req)) {
      return res.status(403).json({ message: MOBILE_BLOCK_MESSAGE });
    }

    // Optional day window set on the exam: entry opens `loginWindowMinutes`
    // before Exam Start and stops at Exam End. Several batches can use the same
    // address inside that window. With no times set, the exam is always open.
    const now = new Date();
    const fmt = (d) => new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    if (exam.startTime) {
      const opensAt = new Date(new Date(exam.startTime).getTime() - (exam.loginWindowMinutes || 5) * 60000);
      if (now < opensAt) {
        return res.status(403).json({ message: `This exam has not opened yet. You may enter from ${fmt(opensAt)}.` });
      }
    }
    if (exam.endTime && now > new Date(exam.endTime)) {
      return res.status(403).json({ message: 'This exam has ended. Entry is closed.' });
    }

    let student = await Student.findOne({ email });
    let assignment = student ? await ExamAssignment.findOne({ student: student._id, exam: exam._id }) : null;

    if (assignment && assignment.status === 'Completed') {
      return res.status(409).json({ message: 'You have already completed this exam.' });
    }
    if (assignment && assignment.personalEndTime && now > new Date(assignment.personalEndTime)) {
      return res.status(409).json({ message: 'Your exam time is over. You cannot enter this exam again.' });
    }

    if (!student) {
      student = await Student.create({ fullName, email, phone });
    } else if (student.fullName !== fullName || student.phone !== phone) {
      student.fullName = fullName;
      student.phone = phone;
      await student.save();
    }

    // One device at a time (first device wins).
    const deviceId = String(req.body.deviceId || '').slice(0, 64);
    const started = await startRoundSession(Student, student._id, 1, deviceId);
    if (!started) {
      return res.status(409).json({
        message: 'You are already logged in on another device. Please continue the exam on that device. If it was closed, wait about one minute and try again.'
      });
    }

    const durationMinutes = Number(exam.durationMinutes) > 0 ? Number(exam.durationMinutes) : 30;

    if (!assignment) {
      const personalStartTime = new Date(now.getTime() + OFFLINE_START_DELAY_MINUTES * 60000);
      const personalEndTime = new Date(personalStartTime.getTime() + durationMinutes * 60000);
      for (let attempt = 0; attempt < 5 && !assignment; attempt++) {
        try {
          assignment = await ExamAssignment.create({
            student: student._id,
            exam: exam._id,
            round: 1,
            accessCode: newAssignmentCode(),
            status: 'InProgress',
            entryMode: 'campus',
            personalStartTime,
            personalEndTime,
            startedAt: now
          });
        } catch (err) {
          if (err && err.code === 11000 && err.keyPattern && err.keyPattern.accessCode) continue; // code clash: try another
          if (err && err.code === 11000) {
            // Two entries at the same moment for the same candidate: use the one that won.
            assignment = await ExamAssignment.findOne({ student: student._id, exam: exam._id });
            break;
          }
          throw err;
        }
      }
      if (!assignment) return res.status(500).json({ message: 'Could not start the exam. Please try again.' });
    } else if (!assignment.personalStartTime) {
      // An assignment from before (e.g. registered earlier): give it personal times now.
      assignment.personalStartTime = new Date(now.getTime() + OFFLINE_START_DELAY_MINUTES * 60000);
      assignment.personalEndTime = new Date(assignment.personalStartTime.getTime() + durationMinutes * 60000);
      assignment.entryMode = 'campus';
      assignment.status = 'InProgress';
      assignment.startedAt = assignment.startedAt || now;
      await assignment.save();
    }
    // (A candidate who signs in again keeps the SAME start and end time.)

    const token = signStudentToken(student, started.sid);
    res.json({
      token,
      student: { id: student._id, fullName: student.fullName, email: student.email, phone: student.phone || '' },
      exam: {
        id: exam._id,
        title: exam.title,
        startTime: assignment.personalStartTime,
        endTime: assignment.personalEndTime,
        durationMinutes,
        serverTime: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error while entering the exam.' });
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