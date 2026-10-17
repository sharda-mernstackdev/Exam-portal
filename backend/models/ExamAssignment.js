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
    // How the candidate got in: 'online' = registered + emailed exam link,
    // 'campus' = the offline exam address (name + email + mobile + access code).
    entryMode: { type: String, enum: ['online', 'campus'], default: 'online' },
    // Offline exam: THIS candidate's own start and end time. The exam starts
    // for each candidate a fixed time (2 minutes) after they entered, and runs
    // for the exam's full duration (all question sets added together).
    personalStartTime: { type: Date },
    personalEndTime: { type: Date },
    invitationSentAt: { type: Date },
    startedAt: { type: Date },
    completedAt: { type: Date }
  },
  { timestamps: true }
);

ExamAssignmentSchema.index({ student: 1, exam: 1 }, { unique: true });

module.exports = mongoose.model('ExamAssignment', ExamAssignmentSchema);