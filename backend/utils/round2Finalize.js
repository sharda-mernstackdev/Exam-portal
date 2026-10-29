const Student = require('../models/Student');
const SecondLevelResult = require('../models/SecondLevelResult');
const SecondLevelExam = require('../models/SecondLevelExam');
const ExamAssignment = require('../models/ExamAssignment');
const Exam = require('../models/Exam');
const { sendFinalSuccessEmail } = require('./mailer');
const { getActiveCodingQuestions } = require('../controllers/codingQuestionController');
const { logViolation } = require('./violation');
const { isCorrectText, isCorrectMcq, chosenIndex } = require('./round2Grade');

// Round 2 timer rules (Campus mode) - all enforced on the server.
//  - The candidate's deadline is fixed by the server when Begin is pressed.
//  - Auto-saved drafts are accepted until DRAFT_GRACE_MS after the deadline.
//  - A normal submission is accepted until SUBMIT_GRACE_MS after the deadline
//    (covers a slow network at the moment the timer hits zero).
//  - After SUBMIT_GRACE_MS the server finalizes the exam itself from the last
//    draft it received, whether or not the browser is still open.
const DRAFT_GRACE_MS = 5 * 1000;
const SUBMIT_GRACE_MS = 30 * 1000;
const DEFAULT_ROUND2_MINUTES = 45; // the Round 2 page's original timer

// Online mode: the candidate submits manually. The server accepts that
// submission until the deadline plus this small allowance for network delay;
// after that the exam can no longer be submitted (it is NOT auto-submitted).
const ONLINE_SUBMIT_GRACE_MS = 10 * 1000;
const ONLINE_EXPIRED_MESSAGE = 'Your Round 2 time is over. This exam had to be submitted manually before the deadline, so it can no longer be submitted. Please contact the administrator.';

// 'campus' | 'online' - the mode of the exam this candidate registered for.
// Round 2 has no mode of its own, so it follows the candidate's exam (an exam
// without the field is 'campus', same as everywhere else in the portal).
async function getRound2Mode(studentId) {
  const assignment = await ExamAssignment.findOne({ student: studentId }).sort({ createdAt: -1 }).select('exam');
  if (!assignment) return 'campus';
  const exam = await Exam.findById(assignment.exam).select('examMode');
  return (exam && exam.examMode) || 'campus';
}

// Duration of the live Round 2 configuration (admin's "Duration (mins)").
async function getRound2DurationMinutes() {
  const cfg = await SecondLevelExam.findOne({ active: true }).sort({ createdAt: -1 }).select('durationMinutes');
  const m = cfg && Number(cfg.durationMinutes);
  return m && m > 0 ? m : DEFAULT_ROUND2_MINUTES;
}

// Cleans + validates answers against the real Round 2 paper (unknown and
// duplicate questions dropped) and MARKS every answer on the server: one mark
// for a correct answer, none otherwise. A question the candidate did not answer
// is stored empty with no mark, so the admin sees every question of the paper.
function cleanAnswers(paper, clientAnswers) {
  const byId = new Map(paper.map((q) => [String(q._id), q]));
  const byTitle = new Map(paper.map((q) => [String(q.title || '').trim().toLowerCase(), q]));
  const seen = new Set();
  const given = [];
  let unknown = 0;
  let duplicate = 0;
  (Array.isArray(clientAnswers) ? clientAnswers : []).forEach((a) => {
    const dbq = (a && a.questionId && byId.get(String(a.questionId))) ||
      (a && byTitle.get(String(a.title || '').trim().toLowerCase()));
    if (!dbq) { unknown++; return; }
    if (seen.has(String(dbq._id))) { duplicate++; return; }
    seen.add(String(dbq._id));
    given.push({ dbq, raw: String((a && a.code) === undefined || (a && a.code) === null ? '' : a.code).slice(0, 5000) });
  });

  const cleaned = given.map(({ dbq, raw }) => {
    let passed = 0;
    let code = raw;
    if (dbq.type === 'mcq') {
      const idx = chosenIndex(dbq, raw);
      passed = isCorrectMcq(dbq, raw) ? 1 : 0;
      code = idx >= 0 ? dbq.options[idx] : '';
    } else {
      passed = isCorrectText(dbq, raw) ? 1 : 0;
    }
    return { questionId: dbq._id, title: dbq.title, type: dbq.type, code, language: dbq.type, passed, total: 1 };
  });
  // Questions that were not answered at all still appear in the result (empty, no mark).
  paper.forEach((q) => {
    if (seen.has(String(q._id))) return;
    cleaned.push({ questionId: q._id, title: q.title, type: q.type, code: '', language: q.type, passed: 0, total: 1 });
  });
  return { cleaned, unknown, duplicate };
}

// Saves the Round 2 result and closes the attempt. The ONE place where a Round
// 2 attempt is finalized - used by the candidate's own submit, the browser's
// auto-submit and the server's deadline enforcement.
//
//  - Exactly once: the attempt is claimed atomically (round2Completed false ->
//    true), so simultaneous or repeated calls cannot both succeed. The loser
//    gets status 409 and nothing is written. Once claimed, the draft endpoint
//    refuses writes too, so the saved answers cannot change any more.
//  - `useDraft: true` finalizes from the last draft the server received
//    (browser gone / too late); otherwise from `answers` of the request.
//  - `deadlineGraceMs` (Online mode): the deadline is part of the atomic
//    claim itself, so a submission that arrives after deadline + grace cannot
//    win even if it passed an earlier check a moment before.
//
// Returns { status, body }.
async function finalizeRound2({ studentId, answers, totalScore, useDraft, reason, deadlineGraceMs }) {
  let claimed = false;
  try {
    const claimFilter = { _id: studentId, round2Completed: { $ne: true } };
    if (deadlineGraceMs !== undefined) {
      claimFilter.round2DeadlineAt = { $gte: new Date(Date.now() - deadlineGraceMs) };
    }
    const student = await Student.findOneAndUpdate(
      claimFilter,
      { $set: { round2Completed: true } },
      { new: true }
    );
    if (!student) {
      const cur = await Student.findById(studentId).select('round2Completed');
      if (!cur) return { status: 404, body: { message: 'Student record not found.' } };
      if (!cur.round2Completed && deadlineGraceMs !== undefined) {
        await noteOnlineExpiry(studentId);
        return { status: 403, body: { expired: true, message: ONLINE_EXPIRED_MESSAGE } };
      }
      return { status: 409, body: { message: 'You have already completed Round 2. Multiple attempts are not allowed.', completed: true } };
    }
    claimed = true;

    const source = useDraft
      ? ((student.round2Draft && student.round2Draft.answers) || []).map((a) => ({
          questionId: a.questionId, code: a.code, language: a.language, passed: a.passed
        }))
      : answers;

    const paper = await getActiveCodingQuestions();
    const { cleaned, unknown, duplicate } = cleanAnswers(paper, source);

    const computedScore = cleaned.reduce((n, a) => n + a.passed, 0);
    if (unknown || duplicate) {
      await logViolation(
        studentId,
        'server_round2_mismatch',
        `Round 2 submission differs from the server's view: unknown questions ${unknown}, duplicates ${duplicate}.`,
        'round2-submit'
      );
    }
    if (useDraft) {
      await logViolation(
        studentId,
        'server_round2_deadline_finalize',
        `Round 2 deadline passed without a submission; the server finalized the exam from the last auto-saved copy (${cleaned.length} question(s)).`,
        'round2-deadline'
      );
    }

    // Round 2 pass criteria: at least 75% of the paper's questions answered correctly.
    const paperCount = paper.length || (cleaned.length || 1);
    const round2Status = computedScore >= paperCount * 0.75 ? 'PASS' : 'FAIL';

    const result = await SecondLevelResult.create({
      student: student._id,
      name: student.fullName,
      email: student.email,
      answers: cleaned,
      totalScore: computedScore,
      round2Status,
      autoSubmitReason: reason || ''
    });

    student.roundProgress.r2 = round2Status;
    // Final "cleared both rounds" email only ever goes to candidates who
    // actually passed Round 2 - never on FAIL, and never twice.
    // Offline exams (entered through the exam's own address): no automatic
    // mail - the admin sends it with the "Send HR round mail" button.
    const offline = await ExamAssignment.exists({ student: student._id, round: 1, entryMode: 'campus' });
    // Save the Round 2 outcome FIRST, so a mail problem can never leave the
    // candidate without a pass/fail status.
    await student.save();
    if (round2Status === 'PASS' && !student.finalEmailSentAt && !offline) {
      try {
        await sendFinalSuccessEmail(student);
        student.finalEmailSentAt = new Date();
        await student.save();
      } catch (mailErr) {
        console.error('Round 2 pass mail could not be sent:', mailErr.message);
      }
    }

    return { status: 201, body: result };
  } catch (err) {
    console.error(err);
    // Claimed but nothing was saved: give the attempt back.
    if (claimed) {
      try {
        const saved = await SecondLevelResult.exists({ student: studentId });
        if (!saved) await Student.updateOne({ _id: studentId }, { $set: { round2Completed: false } });
      } catch (e) { /* ignore */ }
    }
    return { status: 500, body: { message: 'Could not save second-level result.' } };
  }
}

// Online mode: the deadline passed without a manual submission. Nothing is
// submitted for the candidate (no answers are taken from anywhere). Once
// (atomically) this records the event in the proctor log AND adds a
// "NOT SUBMITTED" result row (score 0, FAIL, empty answers) so the admin sees
// it in the Round 2 results. No success email is sent.
async function noteOnlineExpiry(studentId) {
  const first = await Student.findOneAndUpdate(
    { _id: studentId, round2Completed: { $ne: true }, round2ExpiredAt: null },
    { $set: { round2ExpiredAt: new Date() } },
    { new: true }
  );
  if (!first) return;
  await logViolation(
    studentId,
    'server_round2_online_expired',
    'Round 2 (Online mode): the deadline passed without a manual submission. The exam can no longer be submitted.',
    'round2-deadline'
  );
  try {
    const exists = await SecondLevelResult.exists({ student: studentId });
    if (!exists) {
      await SecondLevelResult.create({
        student: first._id,
        name: first.fullName,
        email: first.email,
        answers: [],
        totalScore: 0,
        round2Status: 'FAIL',
        autoSubmitReason: 'missed'
      });
    }
    await Student.updateOne({ _id: studentId }, { $set: { 'roundProgress.r2': 'FAIL' } });
  } catch (err) {
    console.error('Could not record the missed Round 2 online deadline:', err);
  }
}

// If this candidate's deadline (plus the submit grace) has passed and the
// exam is still open, finalize it from the last draft. CAMPUS MODE ONLY: an
// Online-mode attempt is never submitted by the server.
// Returns 'finalized' | 'already' (someone else finalized it) | 'none' (not
// expired) | 'failed' (could not save - will be retried).
async function finalizeIfExpired(studentId) {
  const expired = await Student.exists({
    _id: studentId,
    round2Completed: { $ne: true },
    round2Mode: { $ne: 'online' },
    round2DeadlineAt: { $lte: new Date(Date.now() - SUBMIT_GRACE_MS) }
  });
  if (!expired) return 'none';
  const out = await finalizeRound2({ studentId, useDraft: true, reason: 'deadline' });
  if (out.status === 201) return 'finalized';
  if (out.status === 409) return 'already';
  return 'failed';
}

// Repairs Round 2 attempts that have no usable result:
//  1. campus attempt whose deadline (+ grace) has passed but was never
//     finalized (the deadline sweeper only runs on the live site) -> finalized
//     from the last saved draft.
//  2. completed, NO result -> re-finalized from the last saved draft.
//  3. completed, result exists but status still PENDING -> status copied
//     from the result.
// Safe to run any number of times.
async function repairStuckRound2() {
  let repaired = 0;

  // 1) Expired campus attempts that nobody finalized.
  const expired = await Student.find({
    round2Completed: { $ne: true },
    round2Mode: { $ne: 'online' },
    round2DeadlineAt: { $lte: new Date(Date.now() - SUBMIT_GRACE_MS) }
  }).select('_id');
  for (const st of expired) {
    try {
      const out = await finalizeIfExpired(st._id);
      if (out === 'finalized') repaired++;
    } catch (e) {
      console.error('Round 2 expiry repair failed for', String(st._id), e.message);
    }
  }

  // 2) + 3) Completed but result / status missing.
  const stuck = await Student.find({
    round2Completed: true,
    'roundProgress.r2': { $nin: ['PASS', 'FAIL'] }
  }).select('_id');
  for (const st of stuck) {
    try {
      const result = await SecondLevelResult.findOne({ student: st._id }).sort({ createdAt: -1 });
      if (result) {
        await Student.updateOne({ _id: st._id }, { $set: { 'roundProgress.r2': result.round2Status } });
        repaired++;
        continue;
      }
      await Student.updateOne({ _id: st._id }, { $set: { round2Completed: false } });
      const out = await finalizeRound2({ studentId: st._id, useDraft: true, reason: 'recovered' });
      if (out.status === 201) repaired++;
    } catch (e) {
      console.error('Round 2 repair failed for', String(st._id), e.message);
    }
  }
  return repaired;
}

module.exports = {
  repairStuckRound2,
  DRAFT_GRACE_MS,
  SUBMIT_GRACE_MS,
  ONLINE_SUBMIT_GRACE_MS,
  ONLINE_EXPIRED_MESSAGE,
  DEFAULT_ROUND2_MINUTES,
  getRound2Mode,
  getRound2DurationMinutes,
  cleanAnswers,
  finalizeRound2,
  finalizeIfExpired,
  noteOnlineExpiry
};