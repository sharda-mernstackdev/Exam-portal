const mongoose = require('mongoose');

const SecondLevelResultSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    answers: [
      {
        questionId: { type: mongoose.Schema.Types.ObjectId, ref: 'CodingQuestion' },
        title: String,
        type: String,
        // text question: what the candidate typed; mcq: the option text they chose
        code: String,
        language: String,
        passed: Number,
        total: Number
      }
    ],
    totalScore: { type: Number, default: 0 },
    round2Status: { type: String, enum: ['PASS', 'FAIL', 'PENDING'], default: 'PENDING' },
    // '' = the candidate submitted manually. 'time' / 'violation' = the browser
    // auto-submitted. 'deadline' = the SERVER finalized the exam from the last
    // auto-saved copy because the deadline passed without a submission.
    // 'missed' = Online mode: the candidate never submitted before the deadline
    // (NOT SUBMITTED, score 0, no answers).
    autoSubmitReason: { type: String, default: '' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('SecondLevelResult', SecondLevelResultSchema);