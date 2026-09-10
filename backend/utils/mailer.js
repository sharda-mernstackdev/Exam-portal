const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    return null; // not configured — caller falls back to console logging
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
  });
  return transporter;
}

/**
 * sendMail({ to, subject, html }) — best-effort. If SMTP isn't configured in
 * .env, logs the email to the console instead of throwing, so the rest of
 * the app (result saving, eligibility flags) keeps working during local
 * development without an email account set up.
 */
async function sendMail({ to, subject, html }) {
  const t = getTransporter();
  if (!t) {
    console.log(`[mailer] SMTP not configured — would have sent to ${to}: "${subject}"`);
    return { sent: false, reason: 'smtp_not_configured' };
  }
  try {
    await t.sendMail({ from: process.env.EMAIL_FROM || process.env.SMTP_USER, to, subject, html });
    return { sent: true };
  } catch (err) {
    console.error('[mailer] send failed:', err.message);
    return { sent: false, reason: err.message };
  }
}

function wrapTemplate(title, bodyHtml) {
  return `
  <div style="font-family: 'Segoe UI', Tahoma, sans-serif; max-width: 560px; margin: 0 auto; color: #1e293b;">
    <div style="background: #0f172a; color: #ffc107; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
      <h2 style="margin: 0; font-size: 20px;">Online Exam Portal</h2>
    </div>
    <div style="border: 1px solid #e2e8f0; border-top: none; padding: 28px; border-radius: 0 0 8px 8px;">
      <h3 style="margin-top: 0; color: #0f172a;">${title}</h3>
      ${bodyHtml}
      <p style="margin-top: 28px; font-size: 13px; color: #64748b;">If you have any questions, please contact your exam administrator.</p>
    </div>
  </div>`;
}

async function sendRound2InvitationEmail(student, round2AccessCode, window) {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const link = `${baseUrl}/round2-login?email=${encodeURIComponent(student.email)}&code=${encodeURIComponent(round2AccessCode)}`;
  const windowRow = (window && window.startTime && window.endTime)
    ? `<tr><td style="padding: 8px 0; color: #64748b;">Login window</td><td style="padding: 8px 0; text-align: right; font-weight: bold; color: #b91c1c;">${formatTime(window.startTime)} – ${formatTime(window.endTime)}</td></tr>`
    : '';
  const windowNote = (window && window.startTime && window.endTime)
    ? `<p style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 12px 16px; color: #991b1b;">
         <strong>Important:</strong> you must log in to Round 2 within the window shown above. Access will not be available after this window closes.
       </p>`
    : '';
  const html = wrapTemplate('Congratulations! You have qualified for Round 2', `
    <p>Dear ${student.fullName},</p>
    <p>Congratulations — you have successfully cleared <strong>Round 1</strong> of the assessment and are now eligible for <strong>Round 2</strong>.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tr><td style="padding: 8px 0; color: #64748b;">Round 2 link</td><td style="padding: 8px 0; text-align: right;"><a href="${link}">${link}</a></td></tr>
      <tr><td style="padding: 8px 0; color: #64748b;">Registered email</td><td style="padding: 8px 0; text-align: right; font-weight: bold;">${student.email}</td></tr>
      <tr><td style="padding: 8px 0; color: #64748b;">Round 2 access code</td><td style="padding: 8px 0; text-align: right; font-weight: bold; letter-spacing: 1px;">${round2AccessCode}</td></tr>
      ${windowRow}
    </table>
    ${windowNote}
    <p>Please open the link above and sign in with your registered email and the access code shown, then complete the on-screen system check (camera and fullscreen) before starting the Round 2 assessment.</p>
  `);
  return sendMail({ to: student.email, subject: 'Congratulations! You have qualified for Round 2', html });
}

async function sendFinalSuccessEmail(student) {
  const html = wrapTemplate('Congratulations! You have successfully completed both assessment rounds', `
    <p>Dear ${student.fullName},</p>
    <p>Congratulations — you have successfully cleared both <strong>Round 1</strong> and <strong>Round 2</strong> of the assessment.</p>
    <p>Our team will be in touch with you regarding the next steps in the process.</p>
  `);
  return sendMail({ to: student.email, subject: 'Congratulations! You have successfully completed both assessment rounds', html });
}

function formatDateTime(d) {
  if (!d) return '-';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-US', { day: '2-digit', month: 'long', year: 'numeric' });
}
function formatTime(d) {
  if (!d) return '-';
  return new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// Sent right after a student registers via the exam-specific registration
// link. Contains the scheduled exam window, the exam-access link (with
// email + access code already embedded), and the login-window instructions.
async function sendExamInvitationEmail(student, exam, assignment) {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const link = `${baseUrl}/exam-access/${exam._id}?email=${encodeURIComponent(student.email)}&code=${encodeURIComponent(assignment.accessCode)}`;
  const windowStart = new Date(new Date(exam.startTime).getTime() - (exam.loginWindowMinutes || 5) * 60000);

  const html = wrapTemplate(`Campus Recruitment Exam – Round ${assignment.round} Exam Invitation`, `
    <p>Dear ${student.fullName},</p>
    <p>You have been registered for the following examination:</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tr><td style="padding: 8px 0; color: #64748b;">Exam</td><td style="padding: 8px 0; text-align: right; font-weight: bold;">${exam.title} (Round ${assignment.round})</td></tr>
      <tr><td style="padding: 8px 0; color: #64748b;">Exam date</td><td style="padding: 8px 0; text-align: right;">${formatDateTime(exam.examDate)}</td></tr>
      <tr><td style="padding: 8px 0; color: #64748b;">Exam time</td><td style="padding: 8px 0; text-align: right;">${formatTime(exam.startTime)} – ${formatTime(exam.endTime)}</td></tr>
      <tr><td style="padding: 8px 0; color: #64748b;">Login window</td><td style="padding: 8px 0; text-align: right; font-weight: bold; color: #b91c1c;">${formatTime(windowStart)} – ${formatTime(exam.startTime)}</td></tr>
      <tr><td style="padding: 8px 0; color: #64748b;">Exam link</td><td style="padding: 8px 0; text-align: right;"><a href="${link}">${link}</a></td></tr>
      <tr><td style="padding: 8px 0; color: #64748b;">Access code</td><td style="padding: 8px 0; text-align: right; font-weight: bold; letter-spacing: 1px;">${assignment.accessCode}</td></tr>
    </table>
    <p style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 12px 16px; color: #991b1b;">
      <strong>Important:</strong> you must log in during the login window shown above (before the exam start time). If you do not log in before the exam starts, you will not be permitted to begin the examination.
    </p>
    <p>Please ensure a stable internet connection, a working webcam, and a quiet environment before your login window begins.</p>
  `);
  return sendMail({ to: student.email, subject: `Campus Recruitment Exam – Round ${assignment.round} Exam Invitation`, html });
}

module.exports = { sendMail, sendRound2InvitationEmail, sendFinalSuccessEmail, sendExamInvitationEmail };