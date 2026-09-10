const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const ctrl = require('../controllers/examAssignmentController');
const { adminAuth } = require('../middleware/auth');

const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

// Public — reached via the registration link / emailed exam link, no login required.
router.get('/exams/current-registration', publicLimiter, ctrl.getCurrentRegistrationExam);
router.get('/exams/:examId/public', publicLimiter, ctrl.getPublicExamInfo);
router.post('/exams/:examId/register', publicLimiter, ctrl.registerForExam);
router.post('/exams/:examId/access', publicLimiter, ctrl.verifyExamAccess);

// Admin — registration/attempt tracking for a given exam.
router.get('/admin/exams/:examId/assignments', adminAuth, ctrl.listAssignmentsForExam);

module.exports = router;