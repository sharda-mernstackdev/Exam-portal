const SecondLevelResult = require('../models/SecondLevelResult');
const Student = require('../models/Student');
const {
  DRAFT_GRACE_MS,
  getRound2Mode,
  getRound2DurationMinutes,
  finalizeRound2,
  finalizeIfExpired
} = require('../utils/round2Finalize');

// POST /api/second-level/submissions
//
// What the server verifies (it never takes the browser's word for these):
//  - who is submitting: the student id comes from the signed token, and the
//    Round 2 session / eligibility (and, in Campus Mode, the deadline) were
//    checked by the route middleware;
//  - one attempt only, atomically (two simultaneous submits cannot both win);
//  - which questions: every answer must match a question of the Round 2 paper
//    currently in force (by id, or title); unknown / duplicate ones are dropped;
//  - the totals: `total` is the real number of test cases of that question in
//    the database, `passed` is clamped to 0..total, and the overall score is
//    the SUM of those per-question values - the separate totalScore sent by
//    the browser is ignored (a mismatch is logged as a violation).
//
// Known limit (architecture): candidate code is executed in the candidate's
// browser, so the number of test cases each solution passed is still reported
// by the browser. The server cannot re-run it without a sandboxed code judge
// (a separate execution service); until one exists, a modified browser could
// over-report `passed` within the 0..total range. See the Bug #4 notes.
exports.createSecondLevelResult = async (req, res) => {
  const { answers, totalScore, reason } = req.body;
  const autoSubmitReason = ['time', 'violation'].includes(reason) ? reason : '';
  const out = await finalizeRound2({
    studentId: req.student.id,
    answers,
    totalScore,
    reason: autoSubmitReason
  });
  res.status(out.status).json(out.body);
};

// ---- Round 2 timer (Campus Mode) -----------------------------------------
// GET  /api/second-level/status  - what mode / duration applies, and the
//                                  deadline if the exam was already started
// POST /api/second-level/start   - the candidate pressed Begin: the server
//                                  fixes the start time and deadline (once;
//                                  calling it again returns the same deadline,
//                                  so a refresh cannot restart the clock)
// In Online mode nothing is stored and the page keeps its own timer.
async function timing(req, res, begin) {
  try {
    const studentId = req.student.id;
    const mode = await getRound2Mode(studentId);
    const durationMinutes = await getRound2DurationMinutes();
    const now = new Date();
    if (mode !== 'campus') {
      return res.json({ campus: false, durationMinutes, serverTime: now.toISOString() });
    }

    let st = await Student.findById(studentId).select('round2StartedAt round2DeadlineAt');
    if (begin && !st.round2StartedAt) {
      const started = await Student.findOneAndUpdate(
        { _id: studentId, round2Completed: { $ne: true }, round2StartedAt: null },
        { $set: { round2StartedAt: now, round2DeadlineAt: new Date(now.getTime() + durationMinutes * 60000) } },
        { new: true }
      );
      st = started || (await Student.findById(studentId).select('round2StartedAt round2DeadlineAt'));
    }
    if (!st || !st.round2DeadlineAt) {
      return res.json({ campus: true, started: false, durationMinutes, serverTime: now.toISOString() });
    }
    const deadline = new Date(st.round2DeadlineAt);
    res.json({
      campus: true,
      started: true,
      durationMinutes,
      startedAt: st.round2StartedAt,
      deadlineAt: deadline.toISOString(),
      serverTime: now.toISOString(),
      remainingSeconds: Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 1000))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not read the Round 2 timer.' });
  }
}
exports.round2Status = (req, res) => timing(req, res, false);
exports.round2Start = (req, res) => timing(req, res, true);

// PUT /api/second-level/draft
// The browser auto-saves the candidate's current code (every question, with
// its own language) while the exam runs. These are "the latest answers the
// system has received": if the deadline passes without a submission the
// server finalizes the exam from them.
//  - only while the attempt is open: after the exam is finalized
//    (round2Completed) or after the deadline the write is refused, atomically,
//    so nothing can change once it is finalized;
//  - sizes are limited; the answers are validated against the real paper at
//    finalization time.
exports.saveSecondLevelDraft = async (req, res) => {
  try {
    const studentId = req.student.id;
    const st = await Student.findById(studentId).select('round2DeadlineAt round2Completed');
    if (!st) return res.status(404).json({ message: 'Student record not found.' });
    // No server deadline (Online mode / not started): nothing to save.
    if (!st.round2DeadlineAt) return res.json({ saved: false });

    const input = Array.isArray(req.body && req.body.answers) ? req.body.answers.slice(0, 50) : [];
    const answers = input
      .filter((a) => a && a.questionId)
      .map((a) => {
        let passed = Math.floor(Number(a.passed));
        if (!Number.isFinite(passed) || passed < 0) passed = 0;
        return {
          questionId: String(a.questionId).slice(0, 40),
          code: String(a.code || '').slice(0, 50000),
          language: ['javascript', 'python', 'cpp'].includes(a.language) ? a.language : 'javascript',
          passed: Math.min(passed, 1000)
        };
      });

    const now = Date.now();
    const r = await Student.updateOne(
      {
        _id: studentId,
        round2Completed: { $ne: true },
        round2DeadlineAt: { $gte: new Date(now - DRAFT_GRACE_MS) }
      },
      { $set: { round2Draft: { savedAt: new Date(now), answers } } }
    );
    const matched = r.matchedCount !== undefined ? r.matchedCount : (r.n || 0);
    if (matched > 0) {
      return res.json({ saved: true, serverTime: new Date().toISOString() });
    }

    // Refused: finalized already, or the time is up.
    const cur = await Student.findById(studentId).select('round2Completed');
    if (cur && cur.round2Completed) {
      return res.status(409).json({ completed: true, message: 'Your Round 2 exam has already been submitted.' });
    }
    return res.status(409).json({ timeUp: true, message: 'The Round 2 time is over. Your exam is being submitted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not save your progress.' });
  }
};

// Used by the background sweeper (utils/round2Deadline.js) and the Round 2
// middleware; re-exported here for convenience.
exports.finalizeIfExpired = finalizeIfExpired;

// GET /api/admin/second-level-results
exports.listSecondLevelResults = async (req, res) => {
  res.json(await SecondLevelResult.find().sort({ createdAt: -1 }));
};

// DELETE /api/admin/second-level-results
exports.clearSecondLevelResults = async (req, res) => {
  await SecondLevelResult.deleteMany({});
  res.json({ message: 'All round 2 results cleared.' });
};