const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Student = require('../models/Student');
const Admin = require('../models/Admin');
const Settings = require('../models/Settings');

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

function signAdminToken(admin) {
  return jwt.sign(
    { id: admin._id, username: admin.username, role: 'admin' },
    process.env.ADMIN_JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '6h' }
  );
}

// POST /api/auth/student/login
// Candidates now sign in with a shared access code (set by the admin in the
// Settings tab) instead of an individual password. First time an email is
// seen it registers the candidate; on repeat visits the same access code
// still applies (there's no per-student secret to get wrong).
exports.studentLogin = async (req, res) => {
  try {
    const fullName = (req.body.fullName || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const phone = (req.body.phone || '').trim();
    const accessCode = (req.body.accessCode || '').trim();

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
      return res.status(400).json({ message: 'Please enter the access code provided by your administrator.' });
    }

    const settings = await Settings.findOne({ key: 'portal' });
    const validCode = settings && settings.accessCode;

    if (!validCode) {
      return res.status(503).json({ message: 'No access code has been configured yet. Please contact your administrator.' });
    }
    if (accessCode.toUpperCase() !== validCode.toUpperCase()) {
      return res.status(401).json({ message: 'Incorrect access code. Please check with your administrator and try again.' });
    }

    let student = await Student.findOne({ email });
    if (!student) {
      student = await Student.create({ fullName, email, phone });
    } else {
      // Keep name/phone up to date, same as the old localStorage record merge.
      student.fullName = fullName;
      student.phone = phone;
      student.lastLoginAt = new Date();
      await student.save();
    }

    const token = signStudentToken(student);
    res.json({
      token,
      student: {
        id: student._id,
        fullName: student.fullName,
        email: student.email,
        phone: student.phone
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error during login.' });
  }
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

    const token = signStudentToken(student);
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

exports.verifyAdmin = (req, res) => {
  res.json({ valid: true, admin: req.admin });
};