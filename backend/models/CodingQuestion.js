const mongoose = require('mongoose');

// Round 2 question bank.
//   type 'text' = the question is shown on top and the candidate types the
//                 answer in a box. It is correct only if it matches `answer`
//                 exactly (see utils/round2Grade.js).
//   type 'mcq'  = multiple choice: `options` + `correctIndex` (0 = first option).
//   type 'code' = the old compile-and-run questions. They are no longer used in
//                 the Round 2 paper (kept in the database only so nothing is lost).
const CodingQuestionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    type: { type: String, enum: ['code', 'text', 'mcq'], default: 'code' },
    difficulty: { type: String, enum: ['Easy', 'Medium', 'Hard'], default: 'Easy' },
    description: { type: String, required: true },
    // text question
    answer: { type: String, default: '' },
    // mcq question
    options: [String],
    correctIndex: { type: Number },
    // old code questions
    examples: [{ input: String, output: String }],
    funcName: { type: String },
    starterCode: {
      javascript: String,
      python: String,
      cpp: String
    },
    testCases: [
      {
        input: mongoose.Schema.Types.Mixed,
        expected: mongoose.Schema.Types.Mixed,
        hidden: { type: Boolean, default: false }
      }
    ],
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('CodingQuestion', CodingQuestionSchema);