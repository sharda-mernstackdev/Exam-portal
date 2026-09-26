const Settings = require('../models/Settings');
const Exam = require('../models/Exam');

async function getOrCreate() {
  let settings = await Settings.findOne({ key: 'portal' });
  if (!settings) settings = await Settings.create({ key: 'portal' });
  return settings;
}

// GET /api/settings — public, needed by login/instructions/dashboard pages.
// The access code is deliberately left out here so it can't be scraped by
// anyone hitting this endpoint directly — only the admin (below) can see it.
exports.getSettings = async (req, res) => {
  const settings = await getOrCreate();
  const obj = settings.toObject();
  delete obj.accessCode;

  // If admin has combined sections into a named Test, the exam timer should
  // use that Test's auto-summed duration instead of the flat portal-wide
  // default. No Test configured -> unchanged, existing behaviour.
  const activeTest = await Exam.findOne({ active: true, 'sectionIds.0': { $exists: true } }).populate('sectionIds');
  if (activeTest) {
    obj.round1DurationMinutes = activeTest.sectionIds.reduce((sum, s) => sum + (s.durationMinutes || 0), 0) || obj.round1DurationMinutes;
    obj.activeTestName = activeTest.title;
  }

  res.json(obj);
};

// GET /api/admin/settings — full settings including the access code, for
// the admin dashboard's Settings tab.
exports.adminGetSettings = async (req, res) => {
  res.json(await getOrCreate());
};

// PUT /api/admin/settings
exports.updateSettings = async (req, res) => {
  const settings = await getOrCreate();
  Object.assign(settings, req.body);
  await settings.save();
  res.json(settings);
};