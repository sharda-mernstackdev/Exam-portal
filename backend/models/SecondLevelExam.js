const mongoose = require('mongoose');

const SecondLevelExamSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    durationMinutes: { type: Number, default: 60 },
    questionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CodingQuestion' }],
    startDate: { type: Date },
    endDate: { type: Date },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('SecondLevelExam', SecondLevelExamSchema);
