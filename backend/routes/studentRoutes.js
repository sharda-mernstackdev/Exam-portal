const express = require('express');
const router = express.Router();
const studentCtrl = require('../controllers/studentController');
const proctorCtrl = require('../controllers/proctorController');
const { studentAuth, adminAuth } = require('../middleware/auth');

router.get('/admin/students', adminAuth, studentCtrl.listStudents);
router.get('/admin/candidate-journey', adminAuth, studentCtrl.candidateJourney);
router.post('/admin/round2/send-emails', adminAuth, studentCtrl.sendRound2Emails);
router.post('/admin/final/send-emails', adminAuth, studentCtrl.sendFinalEmails);
router.delete('/admin/students', adminAuth, studentCtrl.clearStudents);
router.delete('/admin/students/:id', adminAuth, studentCtrl.deleteStudent);

router.post('/proctor-log', studentAuth, proctorCtrl.createLog);
router.get('/admin/proctor-logs', adminAuth, proctorCtrl.listLogs);

module.exports = router;