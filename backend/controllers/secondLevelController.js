const SecondLevelResult = require('../models/SecondLevelResult');
const Student = require('../models/Student');
const {
  DRAFT_GRACE_MS,
  getRound2Mode,
  getRound2DurationMinutes,
  ONLINE_SUBMIT_GRACE_MS,
  ONLINE_EXPIRED_MESSAGE,
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
//  - the marks: one mark per correctly answered question, worked out here -
//    the totalScore sent by the browser is ignored.
//
// Online mode: the candidate submits manually (Complete Exam). The server
// only accepts that while the deadline (set when Begin was pressed, plus a few
// seconds for network delay) has not passed - checked inside the atomic claim.
// The exam is never submitted on the candidate's behalf in Online mode.
exports.createSecondLevelResult = async (req, res) => {
  try {
    const { answers, totalScore, reason } = req.body;
    const autoSubmitReason = ['time', 'violation'].includes(reason) ? reason : '';
    const studentId = req.student.id;

    const st = await Student.findById(studentId).select('round2Mode round2StartedAt round2DeadlineAt');
    // The mode is fixed at Begin; before Begin it is read from the exam's configuration.
    const mode = st && st.round2StartedAt ? (st.round2Mode || 'campus') : await getRound2Mode(studentId);
    let deadlineGraceMs;
    if (mode === 'online') {
      if (!st || !st.round2DeadlineAt) {
        return res.status(403).json({ notStarted: true, message: 'Please press "Begin Assessment" to start the exam before submitting it.' });
      }
      deadlineGraceMs = ONLINE_SUBMIT_GRACE_MS;
    }

    const out = await finalizeRound2({
      studentId,
      answers,
      totalScore,
      reason: autoSubmitReason,
      deadlineGraceMs
    });
    res.status(out.status).json(out.body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not save second-level result.' });
  }
};

// ---- Round 2 timer (Campus and Online mode) -----------------------------------------
// GET  /api/second-level/status  - what mode / duration applies, and the
//                                  deadline if the exam was already started
// POST /api/second-level/start   - the candidate pressed Begin: the server
//                                  fixes the start time and deadline (once;
//                                  calling it again returns the same deadline,
//                                  so a refresh cannot restart the clock)
// Both modes get a server-side start time and deadline. `mode` ('campus' |
// 'online') comes from the candidate's exam configuration (Exam.examMode) and
// is frozen when Begin is pressed - the browser never decides it.
async function timing(req, res, begin) {
  try {
    const studentId = req.student.id;
    const durationMinutes = await getRound2DurationMinutes();
    const now = new Date();

    const fields = 'round2StartedAt round2DeadlineAt round2Mode';
    let st = await Student.findById(studentId).select(fields);
    if (!st) return res.status(404).json({ message: 'Student record not found.' });
    const liveMode = await getRound2Mode(studentId);

    if (begin && !st.round2StartedAt) {
      const started = await Student.findOneAndUpdate(
        { _id: studentId, round2Completed: { $ne: true }, round2StartedAt: null },
        { $set: {
            round2StartedAt: now,
            round2DeadlineAt: new Date(now.getTime() + durationMinutes * 60000),
            round2Mode: liveMode
        } },
        { new: true }
      );
      st = started || (await Student.findById(studentId).select(fields));
    }
    // After Begin the stored mode wins (an attempt started before modes were
    // stored counts as campus, as it always did).
    const mode = st.round2StartedAt ? (st.round2Mode || 'campus') : liveMode;
    if (!st.round2DeadlineAt) {
      return res.json({ mode, campus: mode === 'campus', started: false, durationMinutes, serverTime: now.toISOString() });
    }
    const deadline = new Date(st.round2DeadlineAt);
    res.json({
      mode,
      campus: mode === 'campus',
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
// The browser auto-saves the candidate's current answers (every question)
// while the exam runs. These are "the latest answers the
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
    const st = await Student.findById(studentId).select('round2DeadlineAt round2Completed round2Mode');
    if (!st) return res.status(404).json({ message: 'Student record not found.' });
    // Drafts are only kept for Campus mode (the server submits from them at the
    // deadline). Online mode is submitted manually; not started: nothing to save.
    if (st.round2Mode === 'online' || !st.round2DeadlineAt) return res.json({ saved: false });

    const input = Array.isArray(req.body && req.body.answers) ? req.body.answers.slice(0, 50) : [];
    const answers = input
      .filter((a) => a && a.questionId)
      .map((a) => {
        return {
          questionId: String(a.questionId).slice(0, 40),
          code: String(a.code || '').slice(0, 5000),
          language: ['text', 'mcq'].includes(a.language) ? a.language : 'text',
          passed: 0
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