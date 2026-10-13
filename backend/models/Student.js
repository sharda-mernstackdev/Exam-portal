const mongoose = require('mongoose');

const StudentSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    phone: { type: String, required: true, trim: true },
    registeredAt: { type: Date, default: Date.now },
    lastLoginAt: { type: Date },
    // Id of the one currently-valid login session (see utils/session.js).
    // A token carrying any other session id is rejected, which is what stops
    // the same candidate being signed in on two devices at once.
    activeSessionId: { type: String },
    // Browser/device that owns that session, and when it last talked to the
    // server — used to refuse a second device while the first is still active.
    activeDeviceId: { type: String },
    lastSeenAt: { type: Date },
    // Round 2 has its own session (same idea, separate fields) so a Round 1
    // session never blocks or signs out Round 2 and the other way round.
    round2SessionId: { type: String },
    round2DeviceId: { type: String },
    round2LastSeenAt: { type: Date },
    // Multi-round progress tracking (mirrors the old roundProgressData shape)
    roundProgress: {
      r1: { type: String, enum: ['PENDING', 'PASS', 'FAIL'], default: 'PENDING' },
      r2: { type: String, enum: ['PENDING', 'PASS', 'FAIL'], default: 'PENDING' },
      r3: { type: String, enum: ['PENDING', 'PASS', 'FAIL'], default: 'PENDING' },
      r4: { type: String, enum: ['PENDING', 'PASS', 'FAIL'], default: 'PENDING' },
      r5: { type: String, enum: ['PENDING', 'PASS', 'FAIL'], default: 'PENDING' }
    },
    // ---- Two-round eligibility / notification tracking ----
    // round2Eligible is the server-side source of truth for "may this
    // student enter Round 2" — set true only when Round 1 is scored PASS,
    // and checked on every Round 2 API call (see requireRound2Eligible
    // middleware), never trusted from the client.
    round2Eligible: { type: Boolean, default: false },
    round2EmailSentAt: { type: Date },
    // When the Round 2 invitation becomes due (15 min after Round 1 ends).
    round2EmailDueAt: { type: Date },
    round2Completed: { type: Boolean, default: false },
    // ---- Round 2 server-side timer (Campus Mode) ----
    // round2StartedAt is written ONCE, by the server, when the candidate presses
    // Begin; round2DeadlineAt = start + the exam duration. The server enforces
    // this deadline itself (see utils/round2Finalize.js), so a closed or
    // tampered browser cannot extend the exam.
    round2StartedAt: { type: Date },
    round2DeadlineAt: { type: Date },
    // Latest answers/code the server has received while the exam was running
    // (auto-saved by the browser). If the deadline passes without a normal
    // submission, the server finalizes the exam from this copy.
    round2Draft: {
      savedAt: { type: Date },
      answers: [
        { _id: false, questionId: String, code: String, language: String, passed: Number }
      ]
    },
    finalEmailSentAt: { type: Date }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Student', StudentSchema);