const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/questionController');
const { studentAuth, adminAuth, requireRound } = require('../middleware/auth');

// Student-facing (needs to be logged in to fetch exam questions)
router.get('/questions', studentAuth, requireRound(1), ctrl.listActiveQuestions);

// Admin-facing question bank management
router.get('/admin/questions', adminAuth, ctrl.listAllQuestions);
router.post('/admin/questions', adminAuth, ctrl.createQuestion);
router.post('/admin/questions/bulk', adminAuth, ctrl.bulkCreateQuestions);
router.put('/admin/questions/:id', adminAuth, ctrl.updateQuestion);
router.delete('/admin/questions/:id', adminAuth, ctrl.deleteQuestion);

module.exports = router;