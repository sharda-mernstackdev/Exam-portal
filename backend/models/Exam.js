const mongoose = require('mongoose');

// Round 1 exam config (mirrors admin dashboard's "examList")
const ExamSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    durationMinutes: { type: Number, default: 30 },
    qualifyingPct: { type: Number, default: 40 },
    // How many questions this exam's category is supposed to have. The
    // question bank enforces this: once a category reaches its target,
    // no more questions can be added to it (and admin sees N/target in
    // the Existing Exams table).
    totalQuestionsTarget: { type: Number, default: 0 },
    startDate: { type: Date },
    endDate: { type: Date },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Exam', ExamSchema);