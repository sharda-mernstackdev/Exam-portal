/*
 * One-time setup script.
 * Run with: npm run seed
 * Creates the default admin account (from .env) and seeds the two question
 * banks + default settings, matching what login.html / dashboard.html /
 * admin_dashboard.html used to inject into localStorage automatically.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const connectDB = require('../config/db');
const Admin = require('../models/Admin');
const Question = require('../models/Question');
const CodingQuestion = require('../models/CodingQuestion');
const Settings = require('../models/Settings');

const defaultQuestions = [
  { category: 'Aptitude', text: 'A train running at the speed of 60 km/hr crosses a pole in 9 seconds. What is the length of the train?', options: ['120 metres', '180 metres', '324 metres', '150 metres'], correctOption: 3 },
  { category: 'Aptitude', text: 'If A and B together can complete a piece of work in 15 days and B alone in 20 days, in how many days can A alone complete the work?', options: ['60 days', '45 days', '40 days', '30 days'], correctOption: 0 },
  { category: 'Aptitude', text: 'Find the average of all prime numbers between 30 and 50.', options: ['39.8', '38', '37', '39.25'], correctOption: 0 },
  { category: 'Aptitude', text: 'A vendor bought toffees at 6 for a rupee. How many for a rupee must he sell to gain 20%?', options: ['3', '4', '5', '6'], correctOption: 2 },
  { category: 'Aptitude', text: 'What percentage of numbers from 1 to 70 have 1 or 9 in the unit digit?', options: ['14%', '20%', '21%', '10%'], correctOption: 1 },
  { category: 'Reasoning', text: 'Look at this series: 2, 1, (1/2), (1/4), ... What number should come next?', options: ['(1/3)', '(1/8)', '(2/8)', '(1/16)'], correctOption: 1 },
  { category: 'Reasoning', text: 'Suresh is older than Jagan. Suresh is younger than Robert. Who is the oldest?', options: ['Suresh', 'Jagan', 'Robert', 'Data Inadequate'], correctOption: 2 },
  { category: 'Reasoning', text: 'Which word does NOT belong with the others?', options: ['Parsley', 'Basil', 'Dill', 'Mayonnaise'], correctOption: 3 },
  { category: 'Reasoning', text: 'Statements: All green are blue. All blue are white. Conclusion: All green are white.', options: ['Follows', 'Does not follow', 'Either or', 'Neither nor'], correctOption: 0 },
  { category: 'Reasoning', text: 'If CATER = 3120518, then how will DOG be written?', options: ['4157', '4147', '3157', '4158'], correctOption: 0 },
  { category: 'Language', text: 'Choose the synonym for "ABANDON":', options: ['Retain', 'Forsake', 'Adopt', 'Protect'], correctOption: 1 },
  { category: 'Language', text: 'Fill in the blank: "She has been living here ____ 2010."', options: ['for', 'from', 'since', 'by'], correctOption: 2 },
  { category: 'Language', text: 'Identify the correctly spelled word:', options: ['Accommodate', 'Acommodate', 'Accomodate', 'Acocommodate'], correctOption: 0 },
  { category: 'Language', text: 'Choose the antonym for "CANDID":', options: ['Frank', 'Deceitful', 'Honest', 'Sincere'], correctOption: 1 },
  { category: 'Language', text: 'Complete the idiom: "A blessing in _____"', options: ['disguise', 'trouble', 'darkness', 'reality'], correctOption: 0 },
  { category: 'Maths', text: 'What is the derivative of x² with respect to x?', options: ['x', '2x', 'x/2', '2'], correctOption: 1 },
  { category: 'Maths', text: 'Solve for x: 2x + 5 = 15', options: ['5', '10', '7.5', '2.5'], correctOption: 0 },
  { category: 'Maths', text: 'What is the area of a circle with radius 7 cm? (Use π = 22/7)', options: ['154 cm²', '44 cm²', '98 cm²', '308 cm²'], correctOption: 0 },
  { category: 'Maths', text: 'What is log₁₀(1000)?', options: ['1', '2', '3', '4'], correctOption: 2 },
  { category: 'Maths', text: 'What is the value of sin(90°)?', options: ['0', '1', '1/2', 'Undefined'], correctOption: 1 }
];

const defaultCodingQuestions = [
  { type: 'text', title: 'Full form of HTML', difficulty: 'Easy', description: 'Write the full form of HTML.', answer: 'HyperText Markup Language' },
  { type: 'mcq', title: 'Which tag makes a hyperlink in HTML?', difficulty: 'Easy', description: 'Which HTML tag is used to make a hyperlink?', options: ['<a>', '<link>', '<href>', '<url>'], correctIndex: 0 },
  { type: 'text', title: 'SQL keyword to remove duplicate rows', difficulty: 'Easy', description: 'Which SQL keyword is used with SELECT to return only different (unique) values?', answer: 'DISTINCT' },
  { type: 'mcq', title: 'Default port of HTTPS', difficulty: 'Easy', description: 'What is the default port number of HTTPS?', options: ['80', '443', '21', '8080'], correctIndex: 1 },
  { type: 'text', title: 'Command to see git status', difficulty: 'Easy', description: 'Write the git command that shows the changed files in the working directory.', answer: 'git status' },
  { type: 'mcq', title: 'Which is not a JavaScript data type', difficulty: 'Easy', description: 'Which one of these is NOT a primitive data type in JavaScript?', options: ['string', 'boolean', 'array', 'number'], correctIndex: 2 }
];

(async function seed() {
  await connectDB();

  const username = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
  const password = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
  const email = process.env.DEFAULT_ADMIN_EMAIL || 'admin@example.com';

  const existingAdmin = await Admin.findOne({ username });
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash(password, 10);
    await Admin.create({ username, email, passwordHash });
    console.log(`[seed] Created default admin "${username}"`);
  } else {
    console.log(`[seed] Admin "${username}" already exists, skipping.`);
  }

  const qCount = await Question.countDocuments();
  if (qCount === 0) {
    await Question.insertMany(defaultQuestions);
    console.log(`[seed] Inserted ${defaultQuestions.length} default MCQ questions`);
  } else {
    console.log('[seed] Question bank already has data, skipping.');
  }

  const cqCount = await CodingQuestion.countDocuments();
  if (cqCount === 0) {
    await CodingQuestion.insertMany(defaultCodingQuestions);
    console.log(`[seed] Inserted ${defaultCodingQuestions.length} default coding questions`);
  } else {
    console.log('[seed] Coding question bank already has data, skipping.');
  }

  const settings = await Settings.findOne({ key: 'portal' });
  if (!settings) {
    const accessCode = Math.random().toString(36).slice(2, 8).toUpperCase();
    const round2AccessCode = Math.random().toString(36).slice(2, 8).toUpperCase();
    await Settings.create({ key: 'portal', accessCode, round2AccessCode });
    console.log(`[seed] Created default portal settings — Round 1 access code: ${accessCode}, Round 2 access code: ${round2AccessCode}`);
    console.log('[seed] Change these anytime from the admin dashboard Settings tab.');
  } else {
    let changed = false;
    if (!settings.accessCode) { settings.accessCode = Math.random().toString(36).slice(2, 8).toUpperCase(); changed = true; }
    if (!settings.round2AccessCode) { settings.round2AccessCode = Math.random().toString(36).slice(2, 8).toUpperCase(); changed = true; }
    if (changed) {
      await settings.save();
      console.log(`[seed] Generated access codes — Round 1: ${settings.accessCode}, Round 2: ${settings.round2AccessCode}`);
    }
  }

  console.log('[seed] Done.');
  process.exit(0);
})().catch(err => {
  console.error('[seed] Failed:', err);
  process.exit(1);
});