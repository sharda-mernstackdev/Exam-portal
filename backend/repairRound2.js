// Run from the backend folder:  node repairRound2.js
// Runs the Round 2 repair right now and prints exactly what it found/did.
require('dotenv').config();
const mongoose = require('mongoose');
const Student = require('./models/Student');
const SecondLevelResult = require('./models/SecondLevelResult');
const { repairStuckRound2 } = require('./utils/round2Finalize');

async function show(title) {
  const students = await Student.find({ 'roundProgress.r1': 'PASS' });
  console.log('\n=== ' + title + ' ===');
  for (const s of students) {
    const n = await SecondLevelResult.countDocuments({ student: s._id });
    console.log(
      s.fullName, '| r2:', s.roundProgress.r2,
      '| completed:', s.round2Completed,
      '| mode:', s.round2Mode || '-',
      '| deadline:', s.round2DeadlineAt ? s.round2DeadlineAt.toISOString() : '-',
      '| draft answers:', (s.round2Draft && s.round2Draft.answers && s.round2Draft.answers.length) || 0,
      '| results saved:', n
    );
  }
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Now (UTC):', new Date().toISOString());
  await show('BEFORE');
  const n = await repairStuckRound2();
  console.log('\nrepairStuckRound2 finished. Repaired:', n);
  await show('AFTER');
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });