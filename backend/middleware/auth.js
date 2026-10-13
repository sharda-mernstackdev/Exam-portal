const jwt = require('jsonwebtoken');
const Student = require('../models/Student');
const { sessionFields } = require('../utils/session');

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

  // Single-device check: the token must carry the CURRENT session id of the
  // round it was issued for (Round 1 token -> Round 1 session, Round 2 token
  // -> Round 2 session; `rnd` is 2 only in tokens from the Round 2 login). A
  // token without a session id, or with an old one (the same round was opened
  // again after the first session went quiet), is rejected.
  try {
    const round = payload.rnd === 2 ? 2 : 1;
    const f = sessionFields(round);
    const student = payload.sid
      ? await Student.findById(payload.id).select(f.sid).lean()
      : null;
    if (!student || student[f.sid] !== payload.sid) {
      return res.status(401).json({
        message: 'You have been signed out because this account was opened on another device (or your session is no longer valid). Please log in again using your exam link.'
      });
    }
    // Heartbeat: marks this session as live so a second device is refused
    // while this one is in use (see utils/session.js). Only the session that
    // still owns the round can refresh it.
    Student.updateOne({ _id: payload.id, [f.sid]: payload.sid }, { $set: { [f.seen]: new Date() } }).catch(() => {});
    req.student = payload;
    next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Could not verify your session.' });
  }
}

// Round gate for exam endpoints: a Round 1 session cannot be used for Round 2
// calls (and the other way round), so each round is protected by its own
// session. Use after studentAuth.
function requireRound(round) {
  return (req, res, next) => {
    const tokenRound = req.student && req.student.rnd === 2 ? 2 : 1;
    if (tokenRound !== round) {
      return res.status(403).json({
        message: round === 2
          ? 'Please sign in to Round 2 with your Round 2 link.'
          : 'This is a Round 1 action. Please use your Round 1 exam link.'
      });
    }
    next();
  };
}

// Server-side Round 2 gate. This is the actual security boundary — it is
// checked on every Round-2-only API call (fetching coding questions,
// submitting Round 2), independent of which login flow issued the token or
// what the frontend/localStorage thinks. A student who never passed Round 1
// (or whose eligibility was never set) is rejected here even with a
// perfectly valid JWT.
async function requireRound2Eligible(req, res, next) {
  if (!req.student || req.student.rnd !== 2) {
    return res.status(403).json({ message: 'Please sign in to Round 2 with your Round 2 link.' });
  }
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

module.exports = { studentAuth, adminAuth, requireRound2Eligible, requireRound };