import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import LiveClock from "../components/LiveClock";
import ExamAPI from "../api";

// Offline exam entry (campus drive). The exam has its own web address made from
// its name, e.g. www.yoursite.com/raisoniexam. The candidate enters name, email,
// mobile and the access code the admin tells them, presses Submit, and goes to
// the instructions page. The exam starts 2 minutes after their Submit (the
// server fixes each candidate's own start and end time).

const NAME_RE = /^[a-zA-Z\s]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A random id kept in this browser's storage; the server uses it to allow the
// same device to sign in again but refuse a second device.
function getDeviceId() {
  try {
    let id = localStorage.getItem("deviceId");
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
      localStorage.setItem("deviceId", id);
    }
    return id;
  } catch {
    return "";
  }
}

export default function OfflineExamEntry() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [notFound, setNotFound] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ExamAPI.offlineExamInfo(slug)
      .then((info) => setTitle(info.title || ""))
      .catch((err) => setNotFound(err.message || "This exam web address is not valid."));
  }, [slug]);

  function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    const next = {};
    if (!fullName.trim() || !NAME_RE.test(fullName.trim())) next.fullName = "Enter your full name (letters and spaces only).";
    if (!EMAIL_RE.test(email.trim())) next.email = "Enter a valid email address.";
    if (!/^[0-9]{10}$/.test(phone.trim())) next.phone = "Enter a valid 10-digit mobile number.";
    if (!accessCode.trim()) next.accessCode = "Enter the access code given by the exam administrator.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    ExamAPI.campusEntry(slug, {
      fullName: fullName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      accessCode: accessCode.trim(),
      deviceId: getDeviceId()
    })
      .then((data) => {
        localStorage.setItem("studentToken", data.token);
        localStorage.setItem("candidateName", data.student.fullName);
        localStorage.setItem("candidateEmail", data.student.email);
        localStorage.setItem("candidatePhone", data.student.phone || "");
        localStorage.setItem("examStatus", "locked");
        localStorage.setItem("examId", data.exam.id);
        // This candidate's own start / end time: the instructions page counts
        // down to it, and the exam timer ends at it.
        localStorage.setItem("examPersonal", JSON.stringify({
          examId: data.exam.id,
          startTime: data.exam.startTime,
          endTime: data.exam.endTime,
          durationMinutes: data.exam.durationMinutes
        }));
        navigate("/instructions", { replace: true });
      })
      .catch((err) => {
        setBusy(false);
        const msg = err.message || "Could not start the exam. Please try again.";
        if (err.status === 401) setErrors({ accessCode: msg });
        else setErrors({ form: msg });
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
    padding: 20
  };

  if (notFound) {
    return (
      <div style={pageStyle}>
        <div className="text-center text-white">
          <i className="fa-solid fa-circle-exclamation fa-3x mb-3 text-warning"></i>
          <h4>{notFound}</h4>
        </div>
      </div>
    );
  }

  const field = (key, label, icon, input) => (
    <div className="mb-3">
      <label className="form-label fw-bold small text-secondary">{label}</label>
      <div className="input-group">
        <span className="input-group-text"><i className={`fa-solid ${icon} text-muted`}></i></span>
        {input}
      </div>
      {errors[key] && <div className="text-danger small mt-1">{errors[key]}</div>}
    </div>
  );

  return (
    <div style={pageStyle}>
      <LiveClock
        style={{
          position: "absolute", top: 15, right: 20, color: "#fde047",
          background: "rgba(0,0,0,0.2)", padding: "6px 14px", borderRadius: 6, fontSize: "0.85rem"
        }}
      />
      <img
        src="/psk-logo.png"
        alt="PSK Technologies"
        style={{ position: "absolute", top: 15, left: 20, height: 64, background: "#fff", padding: "4px 10px", borderRadius: 6 }}
      />

      <div className="my-4" style={{ background: "#fff", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,0.2)", overflow: "hidden", maxWidth: 480, width: "100%" }}>
        <div style={{ background: "#0f172a", color: "#fff", padding: 25, textAlign: "center" }}>
          <i className="fa-solid fa-graduation-cap fa-2x mb-2 text-warning"></i>
          <h4 className="m-0 fw-bold">{title || "Online Exam Portal"}</h4>
          <span className="badge mt-1" style={{ background: "#e2e8f0", color: "#334155", fontSize: "0.8rem" }}>Round 1 — Enter your details</span>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: 30 }} noValidate>
          {field("fullName", "Full Name", "fa-user",
            <input type="text" className={`form-control ${errors.fullName ? "is-invalid" : ""}`} placeholder="Your full name"
              autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />)}
          {field("email", "Email ID", "fa-envelope",
            <input type="email" className={`form-control ${errors.email ? "is-invalid" : ""}`} placeholder="you@example.com"
              autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />)}
          {field("phone", "Mobile Number", "fa-phone",
            <input type="tel" inputMode="numeric" maxLength={10} className={`form-control ${errors.phone ? "is-invalid" : ""}`} placeholder="10-digit mobile number"
              value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} />)}
          {field("accessCode", "Access Code", "fa-key",
            <input type="text" autoComplete="off" className={`form-control text-uppercase ${errors.accessCode ? "is-invalid" : ""}`} placeholder="Given by the exam administrator"
              style={{ letterSpacing: 2 }} value={accessCode} onChange={(e) => setAccessCode(e.target.value)} />)}

          {errors.form && <div className="alert alert-danger small py-2">{errors.form}</div>}

          <button type="submit" disabled={busy} className="btn w-100 fw-bold" style={{ backgroundColor: "#2a5298", color: "#fff", padding: 12, borderRadius: 8 }}>
            {busy ? <><i className="fa-solid fa-spinner fa-spin me-2"></i>Please wait...</> : <><i className="fa-solid fa-arrow-right me-2"></i>Submit</>}
          </button>
          <div className="small text-muted mt-3 text-center">
            Your exam starts 2 minutes after you press Submit. Use a laptop or desktop.
          </div>
        </form>
      </div>
    </div>
  );
}