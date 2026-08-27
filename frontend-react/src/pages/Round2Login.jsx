import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useExamGuard } from "../hooks/useExamGuard";
import FullscreenGate from "../components/FullscreenGate";
import LiveClock from "../components/LiveClock";
import ExamAPI from "../api";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Round2Login() {
  const navigate = useNavigate();
  const { fullscreen, enter } = useExamGuard(true);

  const [email, setEmail] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();

    if (!fullscreen) {
      alert("You must enable Fullscreen Mode to proceed!");
      enter();
      return;
    }

    const nextErrors = {};
    if (!EMAIL_RE.test(email.trim())) nextErrors.email = "Please enter the email you registered with.";
    if (!accessCode.trim()) nextErrors.accessCode = "Please enter the Round 2 access code from your invitation email.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    ExamAPI.round2Login({ email: email.trim(), round2AccessCode: accessCode.trim() })
      .then((data) => {
        localStorage.setItem("studentToken", data.token);
        localStorage.setItem("candidateName", data.student.fullName);
        localStorage.setItem("candidateEmail", data.student.email);
        localStorage.setItem("candidatePhone", data.student.phone);
        localStorage.setItem("examStatus", "locked");
        navigate("/second-level-exam", { replace: true });
      })
      .catch((err) => {
        setSubmitting(false);
        if (err.status === 401 || err.status === 503) {
          setErrors({ accessCode: err.message || "Incorrect Round 2 access code." });
        } else if (err.status === 403 || err.status === 404 || err.status === 409) {
          setErrors({ email: err.message });
        } else {
          alert(err.message || "Could not connect to the server. Please try again.");
        }
      });
  }

  if (!fullscreen) {
    return (
      <FullscreenGate
        onEnter={enter}
        title="Round 2 — Secure Mode Required"
        message="You must enable Fullscreen Mode to sign in to Round 2."
        buttonLabel="Enter Fullscreen Mode"
      />
    );
  }

  return (
    <div
      style={{
        background: "linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
        userSelect: "none"
      }}
    >
      <LiveClock
        style={{
          position: "absolute", top: 15, right: 20, color: "#fde047",
          background: "rgba(0,0,0,0.2)", padding: "6px 14px", borderRadius: 6, fontSize: "0.85rem"
        }}
      />

      <div className="my-4" style={{ background: "#fff", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,0.2)", overflow: "hidden", maxWidth: 460, width: "100%" }}>
        <div style={{ background: "#0f172a", color: "#fff", padding: 25, textAlign: "center" }}>
          <i className="fa-solid fa-laptop-code fa-2x mb-2 text-warning"></i>
          <h4 className="m-0 fw-bold">Round 2 — Technical Assessment</h4>
          <span className="badge mt-1" style={{ background: "#e2e8f0", color: "#334155", fontSize: "0.8rem" }}>Congratulations on clearing Round 1</span>
        </div>

        <div style={{ padding: 30 }}>
          <p className="text-muted small mb-3">Enter the email you registered with and the Round 2 access code from your invitation email.</p>
          <form onSubmit={handleSubmit} noValidate>
            <div className="mb-3">
              <label className="form-label fw-bold small text-secondary">Registered Email</label>
              <div className="input-group">
                <span className="input-group-text"><i className="fa-solid fa-envelope text-muted"></i></span>
                <input
                  type="email"
                  className={`form-control ${errors.email ? "is-invalid" : ""}`}
                  placeholder="candidate@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              {errors.email && <div className="text-danger small mt-1">{errors.email}</div>}
            </div>

            <div className="mb-4">
              <label className="form-label fw-bold small text-secondary">Round 2 Access Code</label>
              <div className="input-group">
                <span className="input-group-text"><i className="fa-solid fa-key text-muted"></i></span>
                <input
                  type="text"
                  className={`form-control text-uppercase ${errors.accessCode ? "is-invalid" : ""}`}
                  placeholder="From your invitation email"
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                />
              </div>
              {errors.accessCode && <div className="text-danger small mt-1">{errors.accessCode}</div>}
            </div>

            <button type="submit" disabled={submitting} className="btn w-100 mb-2 fw-bold" style={{ backgroundColor: "#2a5298", color: "#fff", padding: 12, borderRadius: 8 }}>
              {submitting ? (
                <><i className="fa-solid fa-spinner fa-spin me-2"></i>Verifying...</>
              ) : (
                <><i className="fa-solid fa-right-to-bracket me-2"></i>Continue to Round 2</>
              )}
            </button>

            <div className="text-center small text-muted">
              Need help? Contact your exam administrator.
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
