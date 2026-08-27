const SecondLevelResult = require('../models/SecondLevelResult');
const Student = require('../models/Student');
const { sendFinalSuccessEmail } = require('../utils/mailer');

// POST /api/second-level/submissions
exports.createSecondLevelResult = async (req, res) => {
  try {
    const { answers, totalScore } = req.body;
    const student = await Student.findById(req.student.id);
    if (!student) return res.status(404).json({ message: 'Student record not found.' });

    const round2Status = totalScore >= (Array.isArray(answers) ? answers.length : 1) / 2 ? 'PASS' : 'FAIL';

    const result = await SecondLevelResult.create({
      student: student._id,
      name: student.fullName,
      email: student.email,
      answers: answers || [],
      totalScore: totalScore || 0,
      round2Status
    });

    student.roundProgress.r2 = round2Status;
    // Multiple Round 2 attempts are not allowed — this is enforced on the
    // backend (see requireRound2Eligible) regardless of frontend state.
    student.round2Completed = true;

    // Final "cleared both rounds" email only ever goes to candidates who
    // actually passed Round 2 — never on FAIL, and never twice.
    if (round2Status === 'PASS' && !student.finalEmailSentAt) {
      await sendFinalSuccessEmail(student);
      student.finalEmailSentAt = new Date();
    }
    await student.save();

    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Could not save second-level result.' });
  }
};

// GET /api/admin/second-level-results
exports.listSecondLevelResults = async (req, res) => {
  res.json(await SecondLevelResult.find().sort({ createdAt: -1 }));
};

// DELETE /api/admin/second-level-results
exports.clearSecondLevelResults = async (req, res) => {
  await SecondLevelResult.deleteMany({});
  res.json({ message: 'All round 2 results cleared.' });
};