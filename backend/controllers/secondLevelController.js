const SecondLevelResult = require('../models/SecondLevelResult');
const Student = require('../models/Student');
const { sendFinalSuccessEmail } = require('../utils/mailer');
const { getActiveCodingQuestions } = require('./codingQuestionController');
const { logViolation } = require('../utils/violation');

// POST /api/second-level/submissions
//
// What the server verifies (it never takes the browser's word for these):
//  - who is submitting: the student id comes from the signed token, and the
//    Round 2 session / eligibility were checked by the route middleware;
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
  let claimed = false;
  try {
    const { answers, totalScore } = req.body;

    // Claim the single Round 2 attempt atomically.
    const student = await Student.findOneAndUpdate(
      { _id: req.student.id, round2Completed: { $ne: true } },
      { $set: { round2Completed: true } },
      { new: true }
    );
    if (!student) {
      const exists = await Student.exists({ _id: req.student.id });
      if (!exists) return res.status(404).json({ message: 'Student record not found.' });
      return res.status(409).json({ message: 'You have already completed Round 2. Multiple attempts are not allowed.' });
    }
    claimed = true;

    // ---- Rebuild/validate the answers against the real paper ----
    const paper = await getActiveCodingQuestions();
    const byId = new Map(paper.map((q) => [String(q._id), q]));
    const byTitle = new Map(paper.map((q) => [String(q.title || '').trim().toLowerCase(), q]));

    const clientAnswers = Array.isArray(answers) ? answers : [];
    const seen = new Set();
    const cleaned = [];
    let unknown = 0;
    let duplicate = 0;
    let overReported = 0;
    clientAnswers.forEach((a) => {
      const dbq = (a && a.questionId && byId.get(String(a.questionId))) ||
        (a && byTitle.get(String(a.title || '').trim().toLowerCase()));
      if (!dbq) { unknown++; return; }
      if (seen.has(String(dbq._id))) { duplicate++; return; }
      seen.add(String(dbq._id));
      const total = Array.isArray(dbq.testCases) ? dbq.testCases.length : 0;
      let passed = Number(a.passed);
      if (!Number.isFinite(passed) || passed < 0) passed = 0;
      passed = Math.floor(passed);
      if (passed > total) { overReported++; passed = total; }
      const lang = ['javascript', 'python', 'cpp'].includes(a.language) ? a.language : 'javascript';
      cleaned.push({
        questionId: dbq._id,
        title: dbq.title,
        code: String(a.code || '').slice(0, 50000),
        language: lang,
        passed,
        total
      });
    });

    const computedScore = cleaned.reduce((n, a) => n + a.passed, 0);
    if (Number(totalScore) !== computedScore || unknown || duplicate || overReported) {
      await logViolation(
        req.student.id,
        'server_round2_mismatch',
        `Round 2 submission differs from the server's view: client score ${totalScore}, server score ${computedScore}, unknown questions ${unknown}, duplicates ${duplicate}, passed>total ${overReported}.`,
        'round2-submit'
      );
    }

    // Round 2 pass criteria (unchanged): candidate must score at least 75% to
    // clear Round 2 and be marked eligible for the final HR round. The
    // question count comes from the real paper, so leaving questions out of
    // the submission cannot raise the percentage.
    const paperCount = paper.length || (cleaned.length || 1);
    const round2Status = computedScore >= paperCount * 0.75 ? 'PASS' : 'FAIL';

    const result = await SecondLevelResult.create({
      student: student._id,
      name: student.fullName,
      email: student.email,
      answers: cleaned,
      totalScore: computedScore,
      round2Status
    });

    student.roundProgress.r2 = round2Status;
    // round2Completed was already set atomically above; this stays enforced
    // on the backend (see requireRound2Eligible) regardless of frontend state.

    // Final "cleared both rounds" email only ever goes to candidates who
    // actually passed Round 2 — never on FAIL, and never twice.
    if (round2Status === 'PASS' && !student.finalEmailSentAt) {
      await sendFinalSuccessEmail(student);
      student.finalEmailSentAt = new Date();
    }
    await student.save();

    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    // Claimed but nothing was saved: give the attempt back.
    if (claimed) {
      try {
        const saved = await SecondLevelResult.exists({ student: req.student.id });
        if (!saved) await Student.updateOne({ _id: req.student.id }, { $set: { round2Completed: false } });
      } catch (e) { /* ignore */ }
    }
    res.status(500).json({ message: 'Could not save second-level result.' });
  }
};

// GET /api/admin/second-level-results
exports.listSecondLevelResults = async (req, res) => {
  res.json(await SecondLevelResult.find().sort({ createdAt: -1 }));
};

// DELETE /api/admin/second-level-results
exports.clearSecondLevelResults = async (req, res) => {
  await SecondLevelResult.deleteMany({});
  res.json({ message: 'All round 2 results cleared.' });
};