const mongoose = require('mongoose');

const SecondLevelExamSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    durationMinutes: { type: Number, default: 60 },
    questionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CodingQuestion' }],
    // ---- Scheduled Round 2 access window ----
    // Mirrors Exam's Round 1 scheduling: startTime/endTime define the window,
    // loginWindowMinutes is how early a passed candidate may log in before
    // startTime. Typically set to open right when Round 1 ends (e.g. Round 1
    // ends 5:35 -> Round 2 startTime = 5:35, loginWindowMinutes = 10 means
    // candidates can log in 5:25-5:35... more commonly here startTime is set
    // to the moment access should open, with loginWindowMinutes = 0).
    startTime: { type: Date },
    endTime: { type: Date },
    loginWindowMinutes: { type: Number, default: 0 },
    startDate: { type: Date },
    endDate: { type: Date },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('SecondLevelExam', SecondLevelExamSchema);