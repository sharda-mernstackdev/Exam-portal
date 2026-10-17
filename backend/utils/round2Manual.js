const Student = require('../models/Student');
const Settings = require('../models/Settings');
const ExamAssignment = require('../models/ExamAssignment');
const { sendFinalSuccessEmail } = require('./mailer');

// Admin mail buttons (Results Report page) for OFFLINE exams.
//
// Round 2 mail ("You passed Round 1, you are eligible for Round 2"):
//   The admin presses the button; the mail goes to every candidate who passed
//   Round 1 and has not been mailed yet, ROUND2_MAIL_DELAY_MINUTES (10 minutes)
//   after the press. Pressing only marks the candidates as "mail due at HH:MM";
//   the mail scheduler (utils/round2Scheduler.js) sends them when that time
//   arrives. Pressing again never schedules or sends anybody twice.
//
// HR-round mail ("You passed Round 2, you are eligible for the HR round"):
//   Sent right away to every candidate who passed Round 2 and was not mailed yet.
//
// Who is included can be narrowed with:
//   examId     - only candidates of this exam (any number of batches of it)
//   studentIds - only these candidates (a single row's button)
const ROUND2_MAIL_DELAY_MINUTES = 10;
const CONCURRENCY = 5;

async function candidateScope({ examId, studentIds }) {
  let scope = null; // null = everyone eligible
  if (examId) {
    const inExam = await ExamAssignment.find({ round: 1, exam: examId }, 'student').lean();
    scope = new Set(inExam.map((a) => String(a.student)));
  }
  if (Array.isArray(studentIds) && studentIds.length) {
    const wanted = new Set(studentIds.map(String));
    scope = scope ? new Set([...scope].filter((id) => wanted.has(id))) : wanted;
  }
  return scope;
}

// The exam address slug of an OFFLINE candidate (their Round 2 link is
// <site>/<slug>/round-2), or '' for an online candidate.
async function offlineSlugFor(studentId) {
  const a = await ExamAssignment.findOne({ student: studentId, round: 1 }).sort({ updatedAt: -1 }).populate('exam', 'slug').lean();
  return a && a.entryMode === 'campus' && a.exam && a.exam.slug ? a.exam.slug : '';
}

// Round 2 mail button: schedule the mails 10 minutes from now.
async function scheduleRound2Mails(opts = {}) {
  const settings = await Settings.findOne({ key: 'portal' });
  if (!settings || !settings.round2AccessCode) {
    const err = new Error('The Round 2 access code is not set yet. Please set it in Settings first.');
    err.status = 400;
    throw err;
  }
  const scope = await candidateScope(opts);
  const filter = {
    round2Eligible: true,
    'roundProgress.r1': 'PASS',
    round2EmailSentAt: null, // not mailed yet
    round2EmailDueAt: null   // and not already scheduled
  };
  if (scope) filter._id = { $in: [...scope] };

  const sendAt = new Date(Date.now() + ROUND2_MAIL_DELAY_MINUTES * 60000);
  const r = await Student.updateMany(filter, { $set: { round2EmailDueAt: sendAt } });
  const scheduled = r.modifiedCount !== undefined ? r.modifiedCount : (r.nModified || 0);
  return { scheduled, sendAt, delayMinutes: ROUND2_MAIL_DELAY_MINUTES };
}

// HR-round mail button: send now. A candidate is claimed with ONE atomic update
// before the mail is sent, so pressing twice (or two admins at once) can never
// send the same candidate two mails; a failed send releases the claim so the
// admin can press the button again to retry just those candidates.
async function sendFinalMailsNow(opts = {}) {
  const scope = await candidateScope(opts);
  const base = { 'roundProgress.r2': 'PASS' };
  const query = { ...base, finalEmailSentAt: null };
  if (scope) query._id = { $in: [...scope] };
  const pending = await Student.find(query, '_id email').lean();

  const result = { total: pending.length, sent: 0, failed: [], smtpMissing: false };
  let next = 0;
  async function worker() {
    for (;;) {
      if (result.smtpMissing) return;
      const mine = pending[next++];
      if (!mine) return;
      const student = await Student.findOneAndUpdate(
        { _id: mine._id, ...base, finalEmailSentAt: null },
        { $set: { finalEmailSentAt: new Date() } },
        { new: true }
      );
      if (!student) continue; // somebody else just mailed this candidate
      const sent = await sendFinalSuccessEmail(student);
      if (sent.sent) {
        result.sent++;
      } else {
        await Student.updateOne({ _id: student._id }, { $unset: { finalEmailSentAt: 1 } });
        if (sent.reason === 'smtp_not_configured') result.smtpMissing = true;
        result.failed.push({ email: student.email, reason: sent.reason });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
  return result;
}

module.exports = { ROUND2_MAIL_DELAY_MINUTES, scheduleRound2Mails, sendFinalMailsNow, offlineSlugFor };