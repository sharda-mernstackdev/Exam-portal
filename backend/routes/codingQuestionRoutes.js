const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/codingQuestionController');
const { studentAuth, adminAuth, requireRound2Eligible } = require('../middleware/auth');

router.get('/coding-questions', studentAuth, requireRound2Eligible, ctrl.listActiveCodingQuestions);

router.get('/admin/coding-questions', adminAuth, ctrl.listAllCodingQuestions);
router.post('/admin/coding-questions', adminAuth, ctrl.createCodingQuestion);
router.post('/admin/coding-questions/bulk', adminAuth, ctrl.bulkCreateCodingQuestions);
router.put('/admin/coding-questions/:id', adminAuth, ctrl.updateCodingQuestion);
router.delete('/admin/coding-questions/:id', adminAuth, ctrl.deleteCodingQuestion);

module.exports = router;