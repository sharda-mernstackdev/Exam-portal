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

async function sendRound2InvitationEmail(student, round2AccessCode) {
  const link = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/round2-login`;
  const html = wrapTemplate('Congratulations! You have qualified for Round 2', `
    <p>Dear ${student.fullName},</p>
    <p>Congratulations — you have successfully cleared <strong>Round 1</strong> of the assessment and are now eligible for <strong>Round 2</strong>.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tr><td style="padding: 8px 0; color: #64748b;">Round 2 link</td><td style="padding: 8px 0; text-align: right;"><a href="${link}">${link}</a></td></tr>
      <tr><td style="padding: 8px 0; color: #64748b;">Registered email</td><td style="padding: 8px 0; text-align: right; font-weight: bold;">${student.email}</td></tr>
      <tr><td style="padding: 8px 0; color: #64748b;">Round 2 access code</td><td style="padding: 8px 0; text-align: right; font-weight: bold; letter-spacing: 1px;">${round2AccessCode}</td></tr>
    </table>
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

module.exports = { sendMail, sendRound2InvitationEmail, sendFinalSuccessEmail };