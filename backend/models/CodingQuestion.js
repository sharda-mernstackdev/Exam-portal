const mongoose = require('mongoose');

const CodingQuestionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    difficulty: { type: String, enum: ['Easy', 'Medium', 'Hard'], default: 'Easy' },
    description: { type: String, required: true },
    examples: [{ input: String, output: String }],
    funcName: { type: String, required: true },
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
