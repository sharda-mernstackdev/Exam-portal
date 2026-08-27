const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const ctrl = require('../controllers/authController');
const { studentAuth, adminAuth } = require('../middleware/auth');

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

router.post('/student/login', loginLimiter, ctrl.studentLogin);
router.post('/round2/login', loginLimiter, ctrl.round2Login);
router.get('/student/verify', studentAuth, ctrl.verifyStudent);

router.post('/admin/login', loginLimiter, ctrl.adminLogin);
router.get('/admin/verify', adminAuth, ctrl.verifyAdmin);

module.exports = router;