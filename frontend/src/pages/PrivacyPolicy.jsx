export default function PrivacyPolicy() {
  const box = {
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
    maxWidth: 820,
    margin: "0 auto",
    padding: "32px 36px",
    lineHeight: 1.65,
    color: "#1e293b",
  };
  const h = { fontSize: "1.1rem", fontWeight: 700, marginTop: 24, marginBottom: 8 };

  return (
    <div
      style={{
        background: "linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)",
        minHeight: "100vh",
        padding: "30px 16px",
        fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
      }}
    >
      <div style={box}>
        <h1 style={{ fontSize: "1.6rem", fontWeight: 700 }}>Privacy Policy</h1>
        <p className="text-muted">PSK Exam Portal, operated by PSK Technologies Pvt. Ltd., Nagpur, India.</p>

        <p>
          This policy explains what information the PSK Exam Portal (the "Portal") collects from
          candidates, why it is collected, and how it is used. By registering for an exam or opening
          an exam link, you agree to this policy.
        </p>

        <h2 style={h}>1. Information we collect</h2>
        <ul>
          <li>Registration details: your full name, email address and mobile number.</li>
          <li>Exam data: your answers, code, scores, results and the time you started and finished.</li>
          <li>
            Exam-integrity data: events such as leaving fullscreen or switching tabs during the exam,
            and the device used to sign in.
          </li>
          <li>
            Google sign-in: when you open an exam link, you sign in with Google. We receive only your
            verified email address from Google. We do not receive your Google password and we do not
            access your Gmail, contacts, Drive or any other Google data.
          </li>
        </ul>

        <h2 style={h}>2. How we use it</h2>
        <ul>
          <li>To register you for the exam and send the exam invitation and result emails.</li>
          <li>
            To confirm that the person opening an exam link is the person who registered, by matching
            the Google account email with the registered email.
          </li>
          <li>To conduct, score and review the exam, and to keep the exam fair.</li>
          <li>To share results with the organisation (such as a college or employer) that arranged the exam.</li>
        </ul>

        <h2 style={h}>3. Sharing</h2>
        <p>
          We do not sell your information. It is shared only with the organisation that arranged the
          exam and with service providers needed to run the Portal (for example hosting, database and
          email delivery), or when the law requires it.
        </p>

        <h2 style={h}>4. Storage and security</h2>
        <p>
          Your data is stored on secured servers and accessed only by authorised administrators. We use
          reasonable technical measures to protect it, but no online system can be guaranteed to be
          completely secure.
        </p>

        <h2 style={h}>5. Retention</h2>
        <p>
          We keep exam records for as long as they are needed for the recruitment or assessment
          process, and for any period required by law. You may ask us to delete your data once that
          purpose is complete.
        </p>

        <h2 style={h}>6. Your choices</h2>
        <p>
          You can ask us to correct or delete your personal information, or ask questions about this
          policy, by contacting us at the email below.
        </p>

        <h2 style={h}>7. Changes</h2>
        <p>We may update this policy from time to time. The latest version is always on this page.</p>

        <h2 style={h}>8. Contact</h2>
        <p>
          PSK Technologies Pvt. Ltd., Nagpur, India<br />
          Email: psktechnologies.arti@gmail.com
        </p>
      </div>
    </div>
  );
}