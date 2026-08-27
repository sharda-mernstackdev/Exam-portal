const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/examController');
const { adminAuth } = require('../middleware/auth');

router.get('/admin/exams', adminAuth, ctrl.listExams);
router.post('/admin/exams', adminAuth, ctrl.createExam);
router.put('/admin/exams/:id', adminAuth, ctrl.updateExam);
router.delete('/admin/exams/:id', adminAuth, ctrl.deleteExam);

router.get('/admin/second-level-exams', adminAuth, ctrl.listSecondLevelExams);
router.post('/admin/second-level-exams', adminAuth, ctrl.createSecondLevelExam);
router.put('/admin/second-level-exams/:id', adminAuth, ctrl.updateSecondLevelExam);
router.delete('/admin/second-level-exams/:id', adminAuth, ctrl.deleteSecondLevelExam);

module.exports = router;
