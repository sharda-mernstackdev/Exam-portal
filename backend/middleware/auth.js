const jwt = require('jsonwebtoken');
const Student = require('../models/Student');

function getToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

// Verifies a student JWT. Used to guard dashboard.html / second_level_exam.html
// on the server side (fixes the "skip straight to the exam" bypass bug).
async function studentAuth(req, res, next) {
  const token = getToken(req);
  if (!token) return res.status(401).json({ message: 'Not logged in. Please log in again.' });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== 'student') throw new Error('wrong role');
  } catch (err) {
    return res.status(401).json({ message: 'Session expired or invalid. Please log in again.' });
  }

  // Single-device check: the token must carry the student's CURRENT session
  // id. A token without one (issued before this rule existed) or with an old
  // one (the student signed in again on another device) is rejected.
  try {
    const student = payload.sid
      ? await Student.findById(payload.id).select('activeSessionId').lean()
      : null;
    if (!student || student.activeSessionId !== payload.sid) {
      return res.status(401).json({
        message: 'You have been signed out because this account was opened on another device (or your session is no longer valid). Please log in again using your exam link.'
      });
    }
    // Heartbeat: marks this session as live so a second device is refused
    // while this one is in use (see utils/session.js).
    Student.updateOne({ _id: payload.id }, { $set: { lastSeenAt: new Date() } }).catch(() => {});
    req.student = payload;
    next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not verify your session.' });
  }
}

// Server-side Round 2 gate. This is the actual security boundary — it is
// checked on every Round-2-only API call (fetching coding questions,
// submitting Round 2), independent of which login flow issued the token or
// what the frontend/localStorage thinks. A student who never passed Round 1
// (or whose eligibility was never set) is rejected here even with a
// perfectly valid JWT.
async function requireRound2Eligible(req, res, next) {
  try {
    const student = await Student.findById(req.student.id);
    if (!student) return res.status(404).json({ message: 'Student record not found.' });
    if (!student.round2Eligible || student.roundProgress.r1 !== 'PASS') {
      return res.status(403).json({ message: 'You are not eligible for Round 2.' });
    }
    if (student.round2Completed) {
      return res.status(409).json({ message: 'You have already completed Round 2. Multiple attempts are not allowed.' });
    }
    next();
  } catch (err) {
    res.status(500).json({ message: 'Could not verify Round 2 eligibility.' });
  }
}

function adminAuth(req, res, next) {
  const token = getToken(req);
  if (!token) return res.status(401).json({ message: 'Admin session required.' });
  try {
    const payload = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
    if (payload.role !== 'admin') throw new Error('wrong role');
    req.admin = payload;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Admin session expired or invalid. Please log in again.' });
  }
}

module.exports = { studentAuth, adminAuth, requireRound2Eligible };