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
    finalEmailSentAt: { type: Date }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Student', StudentSchema);