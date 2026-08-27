import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useExamGuard } from "../hooks/useExamGuard";
import FullscreenGate from "../components/FullscreenGate";
import LiveClock from "../components/LiveClock";
import ExamAPI from "../api";

const NAME_RE = /^[a-zA-Z\s]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^[0-9]{10}$/;

export default function Login() {
  const navigate = useNavigate();
  const { fullscreen, enter } = useExamGuard(true);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
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
    if (!fullName.trim() || !NAME_RE.test(fullName.trim())) {
      nextErrors.fullName = "Please enter your full name (letters and spaces only).";
    }
    if (!EMAIL_RE.test(email.trim())) {
      nextErrors.email = "Please enter a valid email address.";
    }
    if (!MOBILE_RE.test(mobile.trim())) {
      nextErrors.mobile = "Please enter a valid 10-digit mobile number.";
    }
    if (!accessCode.trim()) {
      nextErrors.accessCode = "Please enter the access code provided by your administrator.";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    ExamAPI.studentLogin({
      fullName: fullName.trim(),
      email: email.trim(),
      phone: mobile.trim(),
      accessCode: accessCode.trim()
    })
      .then((data) => {
        localStorage.setItem("studentToken", data.token);
        localStorage.setItem("candidateName", data.student.fullName);
        localStorage.setItem("candidateEmail", data.student.email);
        localStorage.setItem("candidatePhone", data.student.phone);
        localStorage.setItem("examStatus", "locked");
        navigate("/instructions", { replace: true });
      })
      .catch((err) => {
        setSubmitting(false);
        if (err.status === 401 || err.status === 503) {
          setErrors({ accessCode: err.message || "Incorrect access code." });
        } else {
          alert(err.message || "Could not connect to the server. Please try again.");
        }
      });
  }

  if (!fullscreen) {
    return (
      <FullscreenGate
        onEnter={enter}
        title="Exam Portal Secure Mode Required"
        message="You must enable Fullscreen Mode to access the login page and start your examination session."
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
          position: "absolute",
          top: 15,
          right: 20,
          color: "#fde047",
          background: "rgba(0,0,0,0.2)",
          padding: "6px 14px",
          borderRadius: 6,
          fontSize: "0.85rem"
        }}
      />

      <div className="my-4" style={{ background: "#fff", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,0.2)", overflow: "hidden", maxWidth: 480, width: "100%" }}>
        <div style={{ background: "#0f172a", color: "#fff", padding: 25, textAlign: "center" }}>
          <i className="fa-solid fa-graduation-cap fa-2x mb-2 text-warning"></i>
          <h4 className="m-0 fw-bold">Online Exam Portal</h4>
          <span className="badge mt-1" style={{ background: "#e2e8f0", color: "#334155", fontSize: "0.8rem" }}>Candidate Sign In</span>
        </div>

        <div style={{ padding: 30 }}>
          <form onSubmit={handleSubmit} noValidate>
            <div className="mb-3">
              <label className="form-label fw-bold small text-secondary">Full Name</label>
              <div className="input-group">
                <span className="input-group-text"><i className="fa-solid fa-user text-muted"></i></span>
                <input
                  type="text"
                  className={`form-control ${errors.fullName ? "is-invalid" : ""}`}
                  placeholder="John Doe"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
              {errors.fullName && <div className="text-danger small mt-1">{errors.fullName}</div>}
            </div>

            <div className="mb-3">
              <label className="form-label fw-bold small text-secondary">Email Address</label>
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

            <div className="mb-3">
              <label className="form-label fw-bold small text-secondary">Mobile Number</label>
              <div className="input-group">
                <span className="input-group-text"><i className="fa-solid fa-phone text-muted"></i></span>
                <input
                  type="tel"
                  maxLength={10}
                  className={`form-control ${errors.mobile ? "is-invalid" : ""}`}
                  placeholder="10-digit mobile number"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                />
              </div>
              {errors.mobile && <div className="text-danger small mt-1">{errors.mobile}</div>}
            </div>

            <div className="mb-4">
              <label className="form-label fw-bold small text-secondary">Access Code</label>
              <div className="input-group">
                <span className="input-group-text"><i className="fa-solid fa-key text-muted"></i></span>
                <input
                  type="text"
                  className={`form-control text-uppercase ${errors.accessCode ? "is-invalid" : ""}`}
                  placeholder="Enter the code given by your administrator"
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                />
              </div>
              {errors.accessCode && <div className="text-danger small mt-1">{errors.accessCode}</div>}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="btn w-100 mb-3 fw-bold"
              style={{ backgroundColor: "#2a5298", color: "#fff", padding: 12, borderRadius: 8 }}
            >
              {submitting ? (
                <><i className="fa-solid fa-spinner fa-spin me-2"></i>Signing in...</>
              ) : (
                <><i className="fa-solid fa-right-to-bracket me-2"></i>Enter Exam Portal</>
              )}
            </button>

            <div className="text-center small text-muted">
              Need help? Contact system support or exam administrator.
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
