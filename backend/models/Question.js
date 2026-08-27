const mongoose = require('mongoose');

const QuestionSchema = new mongoose.Schema(
  {
    category: { type: String, required: true, trim: true },
    text: { type: String, required: true, trim: true },
    options: { type: [String], required: true, validate: v => v.length >= 2 },
    correctOption: { type: Number, required: true },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Question', QuestionSchema);
