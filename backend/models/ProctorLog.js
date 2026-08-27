const mongoose = require('mongoose');

const ProctorLogSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    type: { type: String, required: true },
    detail: { type: String, default: '' },
    page: { type: String, default: '' },
    at: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.model('ProctorLog', ProctorLogSchema);
