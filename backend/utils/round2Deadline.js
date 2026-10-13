const Student = require('../models/Student');
const { SUBMIT_GRACE_MS, finalizeRound2 } = require('./round2Finalize');

// Server-side Round 2 deadline enforcement (Campus Mode).
//
// A candidate whose personal deadline (plus the short submit grace) has passed
// without a submission - browser closed, computer asleep, internet gone - is
// finalized here from the last copy of their code the server received. The
// browser normally submits by itself at 0:00; this is the safety net, so the
// exam cannot stay open past its deadline.
//
// Safe with several backends on the same database: finalizeRound2 claims the
// attempt atomically, so each exam is finalized exactly once.
let running = false;

async function sweepExpiredRound2() {
  if (running) return;
  running = true;
  try {
    const due = await Student.find({
      round2Completed: { $ne: true },
      round2DeadlineAt: { $lte: new Date(Date.now() - SUBMIT_GRACE_MS) }
    }).select('_id').limit(100);
    for (const s of due) {
      const out = await finalizeRound2({ studentId: s._id, useDraft: true, reason: 'deadline' });
      if (out.status === 201) console.log(`[round2-deadline] finalized ${s._id} from the last saved copy`);
    }
  } catch (err) {
    console.error('[round2-deadline] sweeper error:', err.message);
  } finally {
    running = false;
  }
}

// Same rule as the invitation scheduler: a backend started on a developer
// machine must not finalize live candidates' exams.
function isLocalDev() {
  const url = String(process.env.FRONTEND_URL || 'http://localhost:5173');
  return /localhost|127\.0\.0\.1/i.test(url);
}

function startRound2DeadlineSweeper() {
  if (isLocalDev() && String(process.env.RUN_SCHEDULER).toLowerCase() !== 'true') {
    console.log('[round2-deadline] sweeper not started on localhost (set RUN_SCHEDULER=true to test it locally). The deadline is still enforced on every Round 2 request.');
    return;
  }
  setInterval(sweepExpiredRound2, 30 * 1000);
  sweepExpiredRound2();
}

module.exports = { startRound2DeadlineSweeper, sweepExpiredRound2 };