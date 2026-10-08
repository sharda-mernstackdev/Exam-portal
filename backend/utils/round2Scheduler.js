const Student = require('../models/Student');
const Settings = require('../models/Settings');
const SecondLevelExam = require('../models/SecondLevelExam');
const { sendRound2InvitationEmail } = require('./mailer');

// Round 2 invitation goes out this many minutes AFTER Round 1 has ended
// (not at the moment the student submits).
const ROUND2_EMAIL_DELAY_MINUTES = 15;

// Time at which this student's Round 2 email becomes due:
// the later of "now" and the Round 1 exam's scheduled end time, plus the delay.
function computeRound2EmailDueAt(round1Exam, now = new Date()) {
  const end = round1Exam && round1Exam.endTime ? new Date(round1Exam.endTime) : null;
  const base = end && end > now ? end : now;
  return new Date(base.getTime() + ROUND2_EMAIL_DELAY_MINUTES * 60000);
}

let running = false;

async function sendDueRound2Emails() {
  if (running) return;
  running = true;
  try {
    const settings = await Settings.findOne({ key: 'portal' });
    const round2Code = settings && settings.round2AccessCode;
    if (!round2Code) return; // nothing to send until admin sets the code

    const secondExam = await SecondLevelExam.findOne({ active: true }).sort({ createdAt: -1 });
    const window = secondExam ? { startTime: secondExam.startTime, endTime: secondExam.endTime } : null;

    // Claim students one at a time so a restart / second instance can't
    // send the same invitation twice.
    for (;;) {
      const student = await Student.findOneAndUpdate(
        {
          round2Eligible: true,
          round2EmailSentAt: { $exists: false },
          round2EmailDueAt: { $lte: new Date() }
        },
        { $set: { round2EmailSentAt: new Date() } },
        { new: true }
      );
      if (!student) break;
      const result = await sendRound2InvitationEmail(student, round2Code, window);
      if (!result.sent) {
        // Sending failed (or SMTP not configured): release the claim so the
        // next run retries.
        console.warn(`[round2-mail] could not send to ${student.email}: ${result.reason}`);
        await Student.updateOne({ _id: student._id }, { $unset: { round2EmailSentAt: 1 } });
        break;
      }
      console.log(`[round2-mail] invitation sent to ${student.email}`);
    }
  } catch (err) {
    console.error('[round2-mail] scheduler error:', err.message);
  } finally {
    running = false;
  }
}

function startRound2Scheduler() {
  setInterval(sendDueRound2Emails, 60 * 1000);
  sendDueRound2Emails();
}

module.exports = { startRound2Scheduler, sendDueRound2Emails, computeRound2EmailDueAt, ROUND2_EMAIL_DELAY_MINUTES };