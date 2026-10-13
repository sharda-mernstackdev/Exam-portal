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
  student.lastLoginAt = new Date(); // shows "Logged In" (instead of "Pending") in the admin Students tab
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

// Which Student fields hold the session of a round. Round 1 keeps using the
// original fields; Round 2 has its own, so the two rounds never interfere.
function sessionFields(round) {
  return round === 2
    ? { sid: 'round2SessionId', device: 'round2DeviceId', seen: 'round2LastSeenAt' }
    : { sid: 'activeSessionId', device: 'activeDeviceId', seen: 'lastSeenAt' };
}

// Starts the session for `round` in ONE atomic database update, so two sign-ins
// arriving at the same moment (two devices / two tabs) can never both succeed.
// The update only matches when the round has no live session, or the old one
// has been silent for SESSION_ACTIVE_SECONDS (closed tab / lost internet), or
// it belongs to the same device (same browser signing in again, e.g. refresh).
// Returns { sid } when the session was started, or null when another device
// currently holds a live session (the caller refuses this sign-in).
async function startRoundSession(Student, studentId, round, deviceId) {
  const f = sessionFields(round);
  const now = new Date();
  const cutoff = new Date(now.getTime() - SESSION_ACTIVE_SECONDS * 1000);
  const cleanDevice = String(deviceId || '').slice(0, 64);

  const canStart = [
    { [f.sid]: { $in: [null, ''] } },   // no session yet
    { [f.seen]: null },                  // never seen (also matches missing)
    { [f.seen]: { $lt: cutoff } }        // old session went quiet
  ];
  if (cleanDevice) canStart.push({ [f.device]: cleanDevice }); // same device

  const sid = crypto.randomBytes(16).toString('hex');
  const updated = await Student.findOneAndUpdate(
    { _id: studentId, $or: canStart },
    { $set: { [f.sid]: sid, [f.device]: cleanDevice, [f.seen]: now, lastLoginAt: now } },
    { new: true }
  );
  return updated ? { sid } : null;
}

module.exports = { startSingleSession, isLoggedInElsewhere, startRoundSession, sessionFields, SESSION_ACTIVE_SECONDS };