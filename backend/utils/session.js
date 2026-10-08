const crypto = require('crypto');

// A signed-in exam page re-checks its session every ~15 seconds (see
// frontend/src/hooks/useSessionGuard.js), and each check refreshes
// `lastSeenAt` (middleware/auth.js). If a candidate's session has been seen
// within this many seconds, they are treated as "still logged in somewhere".
const SESSION_ACTIVE_SECONDS = 45;

// Single-device sessions. Every time a student successfully signs in (exam
// link or Round 2 login) a fresh random session id is stored on their Student
// record AND embedded in the JWT they receive. studentAuth (middleware/auth.js)
// rejects any token whose session id no longer matches the stored one.
async function startSingleSession(student, deviceId) {
  student.activeSessionId = crypto.randomBytes(16).toString('hex');
  student.activeDeviceId = deviceId || '';
  student.lastSeenAt = new Date();
  await student.save();
  return student.activeSessionId;
}

// True when this candidate is currently logged in on a DIFFERENT device, so a
// new sign-in from `deviceId` must be refused (first device wins). The same
// device (same browser) may always sign in again, and a session that has gone
// quiet for SESSION_ACTIVE_SECONDS (tab/browser closed, internet lost) no
// longer blocks anyone.
function isLoggedInElsewhere(student, deviceId) {
  if (!student.activeSessionId || !student.lastSeenAt) return false;
  const idleMs = Date.now() - new Date(student.lastSeenAt).getTime();
  if (idleMs > SESSION_ACTIVE_SECONDS * 1000) return false;
  return !deviceId || student.activeDeviceId !== deviceId;
}

module.exports = { startSingleSession, isLoggedInElsewhere, SESSION_ACTIVE_SECONDS };