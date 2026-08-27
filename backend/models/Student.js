const mongoose = require('mongoose');

const StudentSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    phone: { type: String, required: true, trim: true },
    registeredAt: { type: Date, default: Date.now },
    lastLoginAt: { type: Date },
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
    round2Completed: { type: Boolean, default: false },
    finalEmailSentAt: { type: Date }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Student', StudentSchema);