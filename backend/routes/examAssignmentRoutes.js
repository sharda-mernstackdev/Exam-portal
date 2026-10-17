const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const ctrl = require('../controllers/examAssignmentController');
const authCtrl = require('../controllers/authController');
const { adminAuth } = require('../middleware/auth');

const publicLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
// A whole campus shares one network address, so this limit is higher (it still
// stops someone from guessing access codes in bulk).
const campusLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false });

// Public — reached via the registration link / emailed exam link, no login required.
router.get('/exams/current-registration', publicLimiter, ctrl.getCurrentRegistrationExam);
router.get('/exams/:examId/public', publicLimiter, ctrl.getPublicExamInfo);
router.post('/exams/:examId/register', publicLimiter, ctrl.registerForExam);
router.post('/exams/:examId/access', publicLimiter, ctrl.verifyExamAccess);
// Offline exam: name + email + mobile + access code at the exam's own address (no registration, no email link).
router.get('/campus/:slug', campusLimiter, ctrl.offlineExamInfo);
router.post('/campus/:slug/entry', campusLimiter, ctrl.campusEntry);
router.post('/campus/:slug/round2', campusLimiter, authCtrl.campusRound2Login);

// Admin — registration/attempt tracking for a given exam.
router.get('/admin/exams/today-registrations', adminAuth, ctrl.getTodayRegistrationStats);
router.get('/admin/exams/:examId/assignments', adminAuth, ctrl.listAssignmentsForExam);

module.exports = router;