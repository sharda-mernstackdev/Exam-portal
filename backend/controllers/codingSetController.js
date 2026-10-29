const CodingSet = require('../models/CodingSet');
const SecondLevelExam = require('../models/SecondLevelExam');
const CodingQuestion = require('../models/CodingQuestion');

const TITLES = { text: 'Text answer', mcq: 'MCQ' };

// Checks the set sent by the admin. Returns an error text or ''.
function setProblem(b) {
  if (!b || !TITLES[b.type]) return 'Question set must be Text answer or MCQ.';
  if (!(Number(b.durationMinutes) >= 1)) return 'Duration must be at least 1 minute.';
  return '';
}

exports.listCodingSets = async (req, res) => {
  res.json(await CodingSet.find().sort({ createdAt: 1 }));
};

exports.createCodingSet = async (req, res) => {
  try {
    const bad = setProblem(req.body);
    if (bad) return res.status(400).json({ message: bad });
    if (await CodingSet.findOne({ type: req.body.type })) {
      return res.status(400).json({ message: `The "${TITLES[req.body.type]}" question set already exists.` });
    }
    const set = await CodingSet.create({
      type: req.body.type,
      title: TITLES[req.body.type],
      durationMinutes: Number(req.body.durationMinutes),
      totalQuestionsTarget: Math.max(0, Number(req.body.totalQuestionsTarget) || 0),
      active: req.body.active !== false
    });
    res.status(201).json(set);
  } catch (err) {
    res.status(500).json({ message: 'Could not create the question set.' });
  }
};

exports.updateCodingSet = async (req, res) => {
  try {
    const update = {};
    if (req.body.durationMinutes !== undefined) {
      if (!(Number(req.body.durationMinutes) >= 1)) return res.status(400).json({ message: 'Duration must be at least 1 minute.' });
      update.durationMinutes = Number(req.body.durationMinutes);
    }
    if (req.body.totalQuestionsTarget !== undefined) update.totalQuestionsTarget = Math.max(0, Number(req.body.totalQuestionsTarget) || 0);
    if (req.body.active !== undefined) update.active = !!req.body.active;
    const set = await CodingSet.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!set) return res.status(404).json({ message: 'Question set not found.' });
    res.json(set);
  } catch (err) {
    res.status(500).json({ message: 'Could not update the question set.' });
  }
};

// Deleting a set removes the set, takes it out of the tests that use it, and
// deletes its questions from the question bank.
exports.deleteCodingSet = async (req, res) => {
  const set = await CodingSet.findByIdAndDelete(req.params.id);
  if (!set) return res.status(404).json({ message: 'Question set not found.' });
  await CodingQuestion.deleteMany({ type: set.type });
  await SecondLevelExam.updateMany({ sectionIds: set._id }, { $pull: { sectionIds: set._id } });
  res.json({ message: 'Question set deleted.' });
};