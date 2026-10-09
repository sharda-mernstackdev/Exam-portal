import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import LiveClock from "../components/LiveClock";
import ExamAPI from "../api";

const NAME_RE = /^[a-zA-Z\s]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^[0-9]{10}$/;

// Google Sign-In (email ownership check). Set VITE_GOOGLE_CLIENT_ID in the
// frontend .env (and GOOGLE_CLIENT_ID in the backend .env). When it is set,
// a candidate can register only after signing in with the Google account
// whose email they are registering with.
const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();

function decodeJwtPayload(token) {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(b64).split("").map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join("")
    );
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function loadGoogleScript() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.accounts && window.google.accounts.id) return resolve();
    const existing = document.getElementById("google-gsi-script");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", reject);
      return;
    }
    const sc = document.createElement("script");
    sc.id = "google-gsi-script";
    sc.src = "https://accounts.google.com/gsi/client";
    sc.async = true;
    sc.defer = true;
    sc.onload = () => resolve();
    sc.onerror = reject;
    document.head.appendChild(sc);
  });
}

function formatDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-US", {
    weekday: "short",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}
function formatTime(d) {
  if (!d) return "-";
  return new Date(d).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function StudentRegister({ examId: examIdProp }) {
  const { examId: examIdParam } = useParams();
  const examId = examIdProp || examIdParam;

  const [exam, setExam] = useState(null);
  const [loadError, setLoadError] = useState("");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [googleToken, setGoogleToken] = useState("");
  const [googleError, setGoogleError] = useState("");
  const googleBtnRef = useRef(null);

  useEffect(() => {
    ExamAPI.getPublicExamInfo(examId)
      .then(setExam)
      .catch((err) =>
        setLoadError(
          err.message || "This exam is not available for registration.",
        ),
      );
  }, [examId]);

  // Render the "Sign in with Google" button once the form is on screen.
  const formVisible = !!exam && exam.registrationOpen !== false && !done;
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !formVisible || googleToken) return undefined;
    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        if (cancelled || !googleBtnRef.current) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (resp) => {
            const payload = decodeJwtPayload(resp.credential);
            if (!payload || !payload.email) {
              setGoogleError("Google sign-in failed. Please try again.");
              return;
            }
            setGoogleError("");
            setGoogleToken(resp.credential);
            setEmail(String(payload.email).toLowerCase());
            setFullName((prev) => prev || String(payload.name || "").replace(/[^a-zA-Z\s]/g, "").trim());
            setErrors((prev) => ({ ...prev, email: undefined }));
          }
        });
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: "outline", size: "large", text: "signin_with", shape: "rectangular", width: 300
        });
      })
      .catch(() => setGoogleError("Could not load Google sign-in. Check your internet connection and refresh the page."));
    return () => { cancelled = true; };
  }, [formVisible, googleToken]);

  function handleSubmit(e) {
    e.preventDefault();
    const nextErrors = {};
    if (!fullName.trim() || !NAME_RE.test(fullName.trim()))
      nextErrors.fullName =
        "Please enter your full name (letters and spaces only).";
    if (GOOGLE_CLIENT_ID && !googleToken)
      nextErrors.email = "Please sign in with your Google account first. Your registration email must be the Google account signed in on this device.";
    else if (!EMAIL_RE.test(email.trim()))
      nextErrors.email = "Please enter a valid email address.";
    if (!MOBILE_RE.test(phone.trim()))
      nextErrors.phone = "Please enter a valid 10-digit mobile number.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    ExamAPI.registerForExam(examId, {
      fullName: fullName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      googleToken: googleToken || undefined,
    })
      .then(() => setDone(true))
      .catch((err) => {
        setSubmitting(false);
        if (err.status === 401 && GOOGLE_CLIENT_ID) {
          // Google sign-in expired / invalid: ask for a fresh one.
          setGoogleToken("");
          setEmail("");
          setErrors({ email: err.message });
        } else if (err.status === 409) {
          setErrors({ email: err.message });
        } else {
          alert(
            err.message || "Could not connect to the server. Please try again.",
          );
        }
      });
  }

  const pageStyle = {
    background: "linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)",
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
    padding: "20px",
  };

  if (loadError) {
    return (
      <div style={pageStyle}>
        <div className="text-center text-white">
          <i className="fa-solid fa-circle-exclamation fa-3x mb-3 text-warning"></i>
          <h4>{loadError}</h4>
        </div>
      </div>
    );
  }

  if (!exam) {
    return (
      <div style={pageStyle}>
        <div className="spinner-border text-light" role="status"></div>
      </div>
    );
  }

  if (exam.registrationOpen === false) {
    const notStarted = !!exam.registrationNotStarted;
    const when = notStarted ? exam.registrationOpensAt : exam.registrationClosesAt;
    return (
      <div style={pageStyle}>
        <div
          className="text-center"
          style={{
            background: "#fff",
            borderRadius: 12,
            boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
            padding: 36,
            maxWidth: 480,
          }}
        >
          <i className={`fa-solid ${notStarted ? "fa-hourglass-start text-warning" : "fa-lock text-danger"} fa-3x mb-3`}></i>
          <h5 className="fw-bold">{notStarted ? "Registration Not Started" : "Registration Closed"}</h5>
          <p className="text-muted mb-0">
            Registration for <strong>{exam.title}</strong>{" "}
            {notStarted ? "opens on" : "closed on"}{" "}
            <strong>
              {when
                ? new Date(when).toLocaleString("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Asia/Kolkata",
                  })
                : "the scheduled time"}
            </strong>
            .{notStarted ? "" : " Please contact the administrator if you still need access."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <LiveClock
        style={{
          position: "absolute",
          top: 15,
          right: 20,
          color: "#fde047",
          background: "rgba(0,0,0,0.2)",
          padding: "6px 14px",
          borderRadius: 6,
          fontSize: "0.85rem",
        }}
      />

      <img
        src="/psk-logo.png"
        alt="PSK Technologies"
        style={{ position: "absolute", top: 15, left: 20, height: 64, background: "#fff", padding: "4px 10px", borderRadius: 6 }}
      />

      <div
        className="my-4"
        style={{
          background: "#fff",
          borderRadius: 12,
          boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
          overflow: "hidden",
          maxWidth: 520,
          width: "100%",
        }}
      >
        <div
          style={{
            background: "#0f172a",
            color: "#fff",
            padding: 25,
            textAlign: "center",
          }}
        >
          <i className="fa-solid fa-building-columns fa-2x mb-2 text-warning"></i>
          <h4 className="m-0 fw-bold">Campus Recruitment Exam</h4>
          <span
            className="badge mt-1"
            style={{
              background: "#e2e8f0",
              color: "#334155",
              fontSize: "0.8rem",
            }}
          >
            Candidate Registration
          </span>
        </div>

        <div style={{ padding: 30 }}>
          {done ? (
            <div className="text-center py-3">
              <i className="fa-solid fa-circle-check fa-3x text-success mb-3"></i>
              <h5 className="fw-bold">Registration Successful</h5>
              <p className="text-muted">
                Please check your email (<strong>{email}</strong>) for your exam
                invitation, access code, and login window details.
              </p>
            </div>
          ) : (
            <>
              {exam.registrationClosesAt && (
                <div
                  className="small mb-3"
                  style={{
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: 8,
                    padding: "10px 12px",
                    color: "#b91c1c",
                  }}
                >
                  <i className="fa-solid fa-clock me-2"></i>
                  Exam Date &amp; Time: {formatDate(exam.startTime)},{" "}
                  {formatTime(exam.startTime)}. Registration is open only
                  till{" "}
                  <strong>
                    {formatTime(exam.registrationClosesAt)} on{" "}
                    {formatDate(exam.registrationClosesAt)}
                  </strong>
                  — after that, registration cannot be done.
                </div>
              )}

              <div className="bg-light border rounded p-3 mb-4">
                <h6 className="fw-bold mb-2">{exam.title}</h6>
                <div className="small text-secondary">
                  <div>
                    <i className="fa-regular fa-calendar me-2"></i>
                    {formatDate(exam.examDate)}
                  </div>
                  <div>
                    <i className="fa-regular fa-clock me-2"></i>
                    {formatTime(exam.startTime)} – {formatTime(exam.endTime)}
                  </div>
                  <div className="text-danger mt-1">
                    <i className="fa-solid fa-triangle-exclamation me-2"></i>
                    Login opens {exam.loginWindowMinutes || 5} minutes before
                    start time and closes at the start time.
                  </div>
                </div>
                {exam.instructions && (
                  <p className="small mt-2 mb-0" style={{ whiteSpace: "pre-line" }}>
                    {exam.instructions}
                  </p>
                )}
              </div>

              <form onSubmit={handleSubmit} noValidate>
                <div className="mb-3">
                  <label className="form-label fw-bold small text-secondary">
                    Full Name
                  </label>
                  <input
                    type="text"
                    className={`form-control ${errors.fullName ? "is-invalid" : ""}`}
                    placeholder="John Doe"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                  {errors.fullName && (
                    <div className="text-danger small mt-1">
                      {errors.fullName}
                    </div>
                  )}
                </div>
                <div className="mb-3">
                  <label className="form-label fw-bold small text-secondary">
                    Email Address
                  </label>
                  {GOOGLE_CLIENT_ID && !googleToken && (
                    <div className="mb-2">
                      <div ref={googleBtnRef}></div>
                      <div className="small text-muted mt-1">
                        Sign in with the Google account you want to register with. Your exam link will be sent to that email.
                      </div>
                      {googleError && <div className="text-danger small mt-1">{googleError}</div>}
                    </div>
                  )}
                  <input
                    type="email"
                    className={`form-control ${errors.email ? "is-invalid" : ""}`}
                    placeholder={GOOGLE_CLIENT_ID ? "Sign in with Google to fill your email" : "candidate@example.com"}
                    value={email}
                    readOnly={!!GOOGLE_CLIENT_ID}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  {GOOGLE_CLIENT_ID && googleToken && (
                    <div className="small text-success mt-1">
                      <i className="fa-solid fa-circle-check me-1"></i>Email verified with Google
                    </div>
                  )}
                  {errors.email && (
                    <div className="text-danger small mt-1">{errors.email}</div>
                  )}
                </div>
                <div className="mb-4">
                  <label className="form-label fw-bold small text-secondary">
                    Mobile Number
                  </label>
                  <input
                    type="tel"
                    maxLength={10}
                    className={`form-control ${errors.phone ? "is-invalid" : ""}`}
                    placeholder="10-digit mobile number"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                  {errors.phone && (
                    <div className="text-danger small mt-1">{errors.phone}</div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="btn w-100 fw-bold"
                  style={{
                    backgroundColor: "#2a5298",
                    color: "#fff",
                    padding: 12,
                    borderRadius: 8,
                  }}
                >
                  {submitting ? (
                    <>
                      <i className="fa-solid fa-spinner fa-spin me-2"></i>
                      Registering...
                    </>
                  ) : (
                    <>
                      <i className="fa-solid fa-user-plus me-2"></i>Register for
                      Exam
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}