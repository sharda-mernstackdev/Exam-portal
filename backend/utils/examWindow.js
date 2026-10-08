// Entry rule for scheduled exams. Candidates may sign in from
// `loginWindowMinutes` BEFORE the exam start (per-exam setting, default 5)
// until LATE_LOGIN_MINUTES AFTER the start (0 = login closes exactly at the
// start time). Past that point nobody can sign in — not a first-time login,
// not a re-login.
const LATE_LOGIN_MINUTES = 0;

// Someone who signed in just before the cut-off still has to get through the
// 10-second instructions screen and fullscreen prompt before the paper loads,
// so loading the question paper is allowed this much longer than login is.
const PAPER_GRACE_MINUTES = 2;

function lateLoginDeadline(exam) {
  if (!exam || !exam.startTime) return null;
  return new Date(new Date(exam.startTime).getTime() + LATE_LOGIN_MINUTES * 60000);
}

function paperLoadDeadline(exam) {
  const login = lateLoginDeadline(exam);
  return login ? new Date(login.getTime() + PAPER_GRACE_MINUTES * 60000) : null;
}

module.exports = { LATE_LOGIN_MINUTES, PAPER_GRACE_MINUTES, lateLoginDeadline, paperLoadDeadline };