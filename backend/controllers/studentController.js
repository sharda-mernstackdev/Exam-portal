const Student = require('../models/Student');
const Submission = require('../models/Submission');
const SecondLevelResult = require('../models/SecondLevelResult');

// GET /api/admin/students — "Registered Students" tab in admin dashboard
exports.listStudents = async (req, res) => {
  const students = await Student.find({}, '-passwordHash').sort({ registeredAt: -1 });
  res.json(students);
};

// DELETE /api/admin/students — clear all registered students (matches old
// localStorage.removeItem('registeredStudents') admin action)
exports.clearStudents = async (req, res) => {
  await Student.deleteMany({});
  res.json({ message: 'All registered students cleared.' });
};

// DELETE /api/admin/students/:id
exports.deleteStudent = async (req, res) => {
  const student = await Student.findByIdAndDelete(req.params.id);
  if (!student) return res.status(404).json({ message: 'Student not found.' });
  res.json({ message: 'Student deleted.' });
};

// GET /api/admin/candidate-journey — one row per candidate covering the
// full two-round journey (Round 1 result, Round 2 eligibility/result, final
// status), for the admin Results Report tab.
exports.candidateJourney = async (req, res) => {
  const students = await Student.find({}, '-passwordHash');
  const submissions = await Submission.find().sort({ createdAt: -1 });
  const secondResults = await SecondLevelResult.find().sort({ createdAt: -1 });

  const latestSubmissionByStudent = {};
  submissions.forEach((s) => {
    const key = String(s.student);
    if (!latestSubmissionByStudent[key]) latestSubmissionByStudent[key] = s; // already sorted newest-first
  });
  const latestR2ByStudent = {};
  secondResults.forEach((r) => {
    const key = String(r.student);
    if (!latestR2ByStudent[key]) latestR2ByStudent[key] = r;
  });

  const rows = students.map((student) => {
    const r1 = latestSubmissionByStudent[String(student._id)];
    const r2 = latestR2ByStudent[String(student._id)];

    let finalStatus = 'PENDING';
    if (student.roundProgress.r1 === 'FAIL') finalStatus = 'FAILED_ROUND1';
    else if (student.roundProgress.r1 === 'PASS' && student.roundProgress.r2 === 'PASS') finalStatus = 'CLEARED_BOTH';
    else if (student.roundProgress.r1 === 'PASS' && student.roundProgress.r2 === 'FAIL') finalStatus = 'FAILED_ROUND2';
    else if (student.roundProgress.r1 === 'PASS' && student.round2Eligible) finalStatus = 'ROUND2_PENDING';

    return {
      studentId: student._id,
      name: student.fullName,
      email: student.email,
      round1: r1 ? { score: r1.score, total: r1.totalQuestions, percentage: r1.percentage, status: r1.round1Status, submittedOn: r1.createdAt } : null,
      round2Eligible: student.round2Eligible,
      round2EmailSent: !!student.round2EmailSentAt,
      round2: r2 ? { score: r2.totalScore, status: r2.round2Status, submittedOn: r2.createdAt } : null,
      round2Completed: student.round2Completed,
      finalStatus,
      finalEmailSent: !!student.finalEmailSentAt
    };
  });

  res.json(rows);
};