const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Student = require('../models/Student');
const Admin = require('../models/Admin');
const Settings = require('../models/Settings');
const SecondLevelExam = require('../models/SecondLevelExam');
const Exam = require('../models/Exam');
const ExamAssignment = require('../models/ExamAssignment');
const { startRoundSession } = require('../utils/session');
const { isMobileRequest, MOBILE_BLOCK_MESSAGE } = require('../utils/device');
const { requireRegisteredGoogleEmail } = require('../utils/googleAuth');

const NAME_RE = /^[a-zA-Z\s]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^[0-9]{10}$/;

function signStudentToken(student, sid) {
  // rnd: 2 marks this as a Round 2 session (validated against the Round 2
  // session fields, see middleware/auth.js).
  return jwt.sign(
    { id: student._id, email: student.email, name: student.fullName, role: 'student', sid, rnd: 2 },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '6h' }
  );
}

function signAdminToken(admin) {
  return jwt.sign(
    { id: admin._id, username: admin.username, role: 'admin' },
    process.env.ADMIN_JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '6h' }
  );
}

// POST /api/auth/student/login
// DISABLED. This used to let anyone who knew the shared, admin-set access
// code in (name + email + phone + common code), registered or not. Only
// candidates who registered for an exam may sit it, so the only way in now
// is the personal exam link + personal access code emailed after
// registration (POST /api/exams/:examId/access), which checks the
// registration, the code and the scheduled time window. The route is kept
// so any old bookmark/page gets a clear message instead of a 404.
exports.studentLogin = (req, res) => {
  res.status(403).json({
    message: 'Direct sign-in is no longer available. Please register for the exam and use the personal exam link and access code sent to your email.'
  });
};

// GET /api/auth/student/verify — used by dashboard.html / second_level_exam.html
// as the session guard that was previously missing on those pages.
exports.verifyStudent = (req, res) => {
  res.json({ valid: true, student: req.student });
};

// POST /api/auth/round2/login
// Dedicated Round 2 entry point: a student who cleared Round 1 receives an
// email with this link. They sign in again here with just their registered
// email + the Round 2 access code (no name/phone re-entry, since they're
// already registered). This issues a fresh session token, but eligibility
// itself is re-verified server-side on every Round 2 API call afterwards
// (see requireRound2Eligible) — this endpoint is convenience, not the only
// security boundary.
exports.round2Login = async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const round2AccessCode = (req.body.round2AccessCode || '').trim();

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ message: 'Please enter a valid email address.' });
    }
    if (!round2AccessCode) {
      return res.status(400).json({ message: 'Please enter the Round 2 access code from your invitation email.' });
    }

    const student = await Student.findOne({ email });
    if (!student) {
      return res.status(404).json({ message: 'No registration found for this email. Please complete Round 1 first.' });
    }

    if (student.roundProgress.r1 !== 'PASS' || !student.round2Eligible) {
      return res.status(403).json({ message: 'You are not eligible for Round 2. This is shown to Round 1 candidates who did not qualify.' });
    }

    if (student.round2Completed) {
      return res.status(409).json({ message: 'You have already completed Round 2. Multiple attempts are not allowed.' });
    }

    const settings = await Settings.findOne({ key: 'portal' });
    const validCode = settings && settings.round2AccessCode;
    if (!validCode) {
      return res.status(503).json({ message: 'Round 2 has not been configured yet. Please contact your administrator.' });
    }
    if (round2AccessCode.toUpperCase() !== validCode.toUpperCase()) {
      return res.status(401).json({ message: 'Incorrect Round 2 access code. Please check your invitation email.' });
    }

    // ---- Email ownership check (Google Sign-In) ----
    // A forwarded Round 2 link must not work for anyone else: the person has
    // to be signed in to the Google account of the registered email.
    // HARD check: always required, and refused when it is not configured.
    const emailCheck = await requireRegisteredGoogleEmail(req.body.googleToken, student.email, 'Round 2');
    if (emailCheck) return res.status(emailCheck.status).json(emailCheck.body);

    // ---- Round 2 access-window enforcement ----
    // If the admin has scheduled a Round 2 window (e.g. "Round 1 ends 5:35,
    // Round 2 access open 5:35-5:45"), block login outside that window. If
    // no window is configured (startTime/endTime left blank), Round 2 stays
    // open-ended, matching the original behaviour.
    const secondExam = await SecondLevelExam.findOne({ active: true }).sort({ createdAt: -1 });
    if (secondExam && secondExam.startTime && secondExam.endTime) {
      const now = new Date();
      // Login opens `loginWindowMinutes` before the Round 2 start time (0 = at start time).
      const windowStart = new Date(new Date(secondExam.startTime).getTime() - (Number(secondExam.loginWindowMinutes) || 0) * 60000);
      const windowEnd = new Date(secondExam.endTime);
      if (now < windowStart) {
        return res.status(403).json({
          message: `Round 2 access has not opened yet. You may log in from ${windowStart.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}.`
        });
      }
      if (now > windowEnd) {
        return res.status(403).json({
          message: 'Round 2 access time has expired. You were required to log in within the access window after Round 1 ended.'
        });
      }
    }

    if (isMobileRequest(req)) {
      return res.status(403).json({ message: MOBILE_BLOCK_MESSAGE });
    }

    // ---- One device at a time (Round 2 session) ----
    // Atomic: if this candidate already has a live Round 2 session on another
    // device, this sign-in is refused (the first device keeps the exam).
    const deviceId = String(req.body.deviceId || '').slice(0, 64);
    const started = await startRoundSession(Student, student._id, 2, deviceId);
    if (!started) {
      return res.status(409).json({
        message: 'Round 2 is already open on another device. Please continue on that device. If it was closed, wait about one minute and try again.'
      });
    }
    const token = signStudentToken(student, started.sid);
    res.json({
      token,
      student: { id: student._id, fullName: student.fullName, email: student.email, phone: student.phone }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error during Round 2 login.' });
  }
};

// POST /api/campus/:slug/round2
// Round 2 of an OFFLINE exam: www.site.com/<exam>/round-2. The candidate enters
// the email they used in Round 1 and the Round 2 access code; if that email
// passed Round 1 of THIS exam, the exam opens straight away (no Google
// sign-in, no time window - it is done on the college's own devices).
exports.campusRound2Login = async (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim().toLowerCase();
    const exam = slug ? await Exam.findOne({ slug, examMode: 'campus', active: true }) : null;
    if (!exam) return res.status(404).json({ message: 'This exam web address is not valid. Please check the address in your email.' });

    const email = (req.body.email || '').trim().toLowerCase();
    const code = (req.body.round2AccessCode || '').trim();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ message: 'Please enter a valid email address.' });
    }
    if (!code) {
      return res.status(400).json({ message: 'Please enter the Round 2 access code from your email.' });
    }

    const student = await Student.findOne({ email });
    const tookRound1 = student && await ExamAssignment.exists({ student: student._id, exam: exam._id, round: 1 });
    if (!student || !tookRound1) {
      return res.status(404).json({ message: 'No Round 1 record was found for this email in this exam. Please use the email you gave in Round 1.' });
    }
    if (student.roundProgress.r1 !== 'PASS' || !student.round2Eligible) {
      return res.status(403).json({ message: 'You are not eligible for Round 2. Only candidates who passed Round 1 can enter.' });
    }
    if (student.round2Completed) {
      return res.status(409).json({ message: 'You have already completed Round 2. Multiple attempts are not allowed.' });
    }

    const settings = await Settings.findOne({ key: 'portal' });
    const validCode = settings && settings.round2AccessCode;
    if (!validCode) {
      return res.status(503).json({ message: 'Round 2 has not been configured yet. Please contact your administrator.' });
    }
    if (code.toUpperCase() !== validCode.toUpperCase()) {
      return res.status(401).json({ message: 'Incorrect Round 2 access code. Please check your email.' });
    }

    if (isMobileRequest(req)) {
      return res.status(403).json({ message: MOBILE_BLOCK_MESSAGE });
    }

    const deviceId = String(req.body.deviceId || '').slice(0, 64);
    const started = await startRoundSession(Student, student._id, 2, deviceId);
    if (!started) {
      return res.status(409).json({
        message: 'Round 2 is already open on another device. Please continue on that device. If it was closed, wait about one minute and try again.'
      });
    }
    const token = signStudentToken(student, started.sid);
    res.json({
      token,
      student: { id: student._id, fullName: student.fullName, email: student.email, phone: student.phone }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error during Round 2 login.' });
  }
};

// POST /api/auth/admin/login
exports.adminLogin = async (req, res) => {
  try {
    const username = (req.body.username || '').trim();
    const password = (req.body.password || '').trim();

    const admin = await Admin.findOne({ username });
    if (!admin) return res.status(401).json({ message: 'Invalid Username or Password!' });

    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) return res.status(401).json({ message: 'Invalid Username or Password!' });

    const token = signAdminToken(admin);
    res.json({ token, admin: { id: admin._id, username: admin.username, email: admin.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error during admin login.' });
  }
};

// POST /api/auth/admin/change-password
// The logged-in admin changes their own password. The current password must
// be given again, so a left-open admin screen cannot be used to take over.
exports.changeAdminPassword = async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Please enter your current password and a new password.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'The new password must be at least 8 characters long.' });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ message: 'The new password must be different from the current password.' });
    }

    const admin = await Admin.findById(req.admin.id);
    if (!admin) return res.status(404).json({ message: 'Admin account not found.' });

    const ok = await bcrypt.compare(currentPassword, admin.passwordHash);
    if (!ok) return res.status(401).json({ message: 'Current password is incorrect.' });

    admin.passwordHash = await bcrypt.hash(newPassword, 10);
    await admin.save();
    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error while changing the password.' });
  }
};

exports.verifyAdmin = (req, res) => {
  res.json({ valid: true, admin: req.admin });
};