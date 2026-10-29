const mongoose = require('mongoose');

const SecondLevelExamSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    durationMinutes: { type: Number, default: 60 },
    // The Round 2 question sets (Text answer / MCQ) combined in this test -
    // same idea as Round 1's "Create Test". The paper is made from the questions
    // of these sets. durationMinutes is the sum of the sets' durations.
    sectionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CodingSet' }],
    questionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CodingQuestion' }],
    // ---- Scheduled Round 2 access window ----
    // Mirrors Exam's Round 1 scheduling: startTime/endTime define the window,
    // loginWindowMinutes is how early a passed candidate may log in before
    // startTime.
    startTime: { type: Date },
    endTime: { type: Date },
    loginWindowMinutes: { type: Number, default: 0 },
    startDate: { type: Date },
    endDate: { type: Date },
    // 'online' (default, with the access window) or 'campus' = Offline exam (no window).
    examMode: { type: String, enum: ['online', 'campus'], default: 'online' },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('SecondLevelExam', SecondLevelExamSchema);