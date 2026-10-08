const mongoose = require('mongoose');

// Round 1 exam config (mirrors admin dashboard's "examList")
const ExamSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    durationMinutes: { type: Number, default: 30 },
    qualifyingPct: { type: Number, default: 40 },
    totalQuestionsTarget: { type: Number, default: 0 },
    instructions: { type: String, trim: true },
    // ---- Scheduled exam session ----
    // examDate + startTime + endTime define the exam window; loginWindowMinutes
    // is how early (in minutes) a student may log in before startTime. A
    // student who never logs in before startTime is blocked afterwards
    // (enforced server-side in examAssignmentController).
    examDate: { type: Date },
    startTime: { type: Date },
    endTime: { type: Date },
    loginWindowMinutes: { type: Number, default: 5 },
    startDate: { type: Date },
    endDate: { type: Date },
    active: { type: Boolean, default: true },
    // How the exam ends for candidates:
    //   'online'  — a candidate may finish and submit any time before the end
    //               time (online / remote exam).
    //   'campus'  — the exam can only be submitted when the timer / scheduled
    //               end time is reached (campus drive, everyone ends together).
    // Existing exams without this field behave as 'campus' (the previous rule).
    examMode: { type: String, enum: ['online', 'campus'], default: 'campus' },
    // ---- Combined "Test" support ----
    // When non-empty, this Exam record represents a combined Test built by
    // picking existing section exams (each an independent question-set
    // category, e.g. "Aptitude", "Reasoning"). A Test has no questions of
    // its own — its duration/total-questions are auto-summed from the
    // referenced sections. A record with an empty sectionIds array is a
    // plain section, exactly as before — nothing changes for existing data.
    sectionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Exam' }]
  },
  { timestamps: true }
);

module.exports = mongoose.model('Exam', ExamSchema);