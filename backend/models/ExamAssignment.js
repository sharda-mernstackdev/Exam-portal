const mongoose = require('mongoose');

// Links a Student to a specific scheduled Exam (Round 1 or Round 2) via a
// unique per-registration access code. This is the source of truth for the
// "registration link -> email invite -> timed exam access" flow — separate
// from the older shared-access-code login, which still works unchanged.
const ExamAssignmentSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true },
    round: { type: Number, enum: [1, 2], default: 1 },
    accessCode: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ['Registered', 'InvitationSent', 'NotStarted', 'InProgress', 'Completed'],
      default: 'Registered'
    },
    invitationSentAt: { type: Date },
    startedAt: { type: Date },
    completedAt: { type: Date }
  },
  { timestamps: true }
);

ExamAssignmentSchema.index({ student: 1, exam: 1 }, { unique: true });

module.exports = mongoose.model('ExamAssignment', ExamAssignmentSchema);