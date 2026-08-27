const mongoose = require('mongoose');

// Singleton document — always read/written with key: 'portal'
const SettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'portal', unique: true },
    portalName: { type: String, default: 'Online Exam Portal' },
    qualifyingPct: { type: Number, default: 70 },
    round1DurationMinutes: { type: Number, default: 30 },
    round2DurationMinutes: { type: Number, default: 60 },
    // Shared code all candidates use instead of an individual password.
    // Admin can view/regenerate this from the Settings tab.
    accessCode: { type: String, default: '' },
    // Separate code required to enter Round 2 — only issued to (and only
    // useful for) candidates who passed Round 1. Kept distinct from
    // accessCode so Round 1 and Round 2 access can be rotated independently.
    round2AccessCode: { type: String, default: '' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Settings', SettingsSchema);