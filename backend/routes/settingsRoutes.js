const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/settingsController');
const { adminAuth } = require('../middleware/auth');

router.get('/settings', ctrl.getSettings); // public: login/instructions/dashboard need qualifyingPct etc.
router.get('/admin/settings', adminAuth, ctrl.adminGetSettings);
router.put('/admin/settings', adminAuth, ctrl.updateSettings);

module.exports = router;
