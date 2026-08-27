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
        code: String,
        language: String,
        passed: Number,
        total: Number
      }
    ],
    totalScore: { type: Number, default: 0 },
    round2Status: { type: String, enum: ['PASS', 'FAIL', 'PENDING'], default: 'PENDING' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('SecondLevelResult', SecondLevelResultSchema);
