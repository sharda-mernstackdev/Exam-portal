const mongoose = require('mongoose');

const SecondLevelExamSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    durationMinutes: { type: Number, default: 60 },
    // Which difficulty set of the Round 2 coding-question bank this config
    // serves — candidates who log in while this exam's access window is
    // open (see submissionController's "current active SecondLevelExam"
    // lookup) get exactly the CodingQuestion docs matching this difficulty.
    difficulty: { type: String, enum: ['Easy', 'Medium', 'Hard'] },
    questionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CodingQuestion' }],
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