const Settings = require('../models/Settings');

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
