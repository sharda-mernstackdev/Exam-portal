const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/submissionController');
const secondLevelCtrl = require('../controllers/secondLevelController');
const { studentAuth, adminAuth, requireRound2Eligible } = require('../middleware/auth');

router.post('/submissions', studentAuth, ctrl.createSubmission);
router.get('/submissions/mine', studentAuth, ctrl.myLatestSubmission);

router.post('/second-level/submissions', studentAuth, requireRound2Eligible, secondLevelCtrl.createSecondLevelResult);

router.get('/admin/submissions', adminAuth, ctrl.listSubmissions);
router.delete('/admin/submissions', adminAuth, ctrl.clearSubmissions);
router.get('/admin/round-progress', adminAuth, ctrl.roundProgress);
router.get('/admin/second-level-results', adminAuth, secondLevelCtrl.listSecondLevelResults);
router.delete('/admin/second-level-results', adminAuth, secondLevelCtrl.clearSecondLevelResults);

module.exports = router;