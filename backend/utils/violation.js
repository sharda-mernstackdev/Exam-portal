const ProctorLog = require('../models/ProctorLog');

// Records a server-detected suspicious event in the SAME collection the
// browser proctoring uses (ProctorLog), so it shows up in the admin's
// existing proctor-log view. Types are prefixed "server_" so they are easy to
// tell apart from browser-reported events. Never throws: logging must not
// break an exam submission.
async function logViolation(studentId, type, detail, page) {
  try {
    await ProctorLog.create({
      student: studentId,
      type: String(type).slice(0, 60),
      detail: String(detail || '').slice(0, 500),
      page: page || 'server'
    });
  } catch (e) {
    console.error('[violation] could not log', type, e.message);
  }
}

module.exports = { logViolation };