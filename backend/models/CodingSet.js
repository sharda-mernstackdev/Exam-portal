const mongoose = require('mongoose');

// A Round 2 "question set". Round 2 has only two sets: 'text' (Text answer) and
// 'mcq' (MCQ). A set holds the duration and the number of questions; the
// questions of that type in the Round 2 question bank belong to it. A Round 2
// test (SecondLevelExam) combines one or more sets through `sectionIds`.
const CodingSetSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['text', 'mcq'], required: true, unique: true },
    title: { type: String, required: true, trim: true },
    durationMinutes: { type: Number, default: 30 },
    totalQuestionsTarget: { type: Number, default: 0 },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('CodingSet', CodingSetSchema);