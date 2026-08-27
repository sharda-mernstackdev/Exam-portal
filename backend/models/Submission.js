const mongoose = require('mongoose');

// Round 1 (MCQ) submission — one per candidate attempt.
const SubmissionSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    score: { type: Number, required: true },
    totalQuestions: { type: Number, required: true },
    percentage: { type: Number, required: true },
    // Snapshot of the questions & answers at submission time, so results stay
    // accurate even if the admin edits the question bank afterwards.
    questions: [
      {
        text: String,
        section: String,
        options: [String],
        correctOption: Number
      }
    ],
    userAnswers: { type: mongoose.Schema.Types.Mixed, default: {} },
    round1Status: { type: String, enum: ['PASS', 'FAIL'], required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Submission', SubmissionSchema);
