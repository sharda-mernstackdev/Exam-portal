import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import LiveClock from "../components/LiveClock";
import ExamAPI from "../api";

export default function AdminLogin() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    ExamAPI.adminLogin({ username: username.trim(), password: password.trim() })
      .then((data) => {
        sessionStorage.setItem("adminSession", "active");
        sessionStorage.setItem("adminToken", data.token);
        sessionStorage.setItem("adminEmail", data.admin.email || "");
        navigate("/admin-dashboard", { replace: true });
      })
      .catch((err) => {
        setSubmitting(false);
        setError(err.message || "Invalid Username or Password!");
      });
  }

  return (
    <div
      style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"
      }}
    >
      <LiveClock
        style={{
          position: "absolute",
          top: 15,
          right: 20,
          color: "#38bdf8",
          background: "rgba(255,255,255,0.1)",
          padding: "6px 14px",
          borderRadius: 6,
          fontSize: "0.85rem"
        }}
      />

      <div className="my-4" style={{ background: "#fff", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,0.3)", overflow: "hidden", maxWidth: 420, width: "100%" }}>
        <div style={{ background: "#1e1b4b", color: "#fff", padding: "30px 20px", textAlign: "center" }}>
          <i className="fa-solid fa-user-shield fa-3x mb-2 text-warning"></i>
          <h4 className="fw-bold mb-1">Admin Portal</h4>
          <p className="small mb-0 text-light">Exam Results & Monitoring Panel</p>
        </div>

        <div className="p-4">
          <form onSubmit={handleSubmit} noValidate>
            <div className="mb-3">
              <label className="form-label fw-bold small text-secondary">Admin Username</label>
              <div className="input-group">
                <span className="input-group-text"><i className="fa-solid fa-user text-muted"></i></span>
                <input type="text" className="form-control" placeholder="admin" value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
            </div>

            <div className="mb-4">
              <label className="form-label fw-bold small text-secondary">Password</label>
              <div className="input-group">
                <span className="input-group-text"><i className="fa-solid fa-lock text-muted"></i></span>
                <input type="password" className="form-control" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              {error && <div className="text-danger small mt-1">{error}</div>}
            </div>

            <button type="submit" disabled={submitting} className="btn w-100 mb-3 fw-bold" style={{ backgroundColor: "#4f46e5", color: "#fff", padding: 12, borderRadius: 8 }}>
              {submitting ? (
                <><i className="fa-solid fa-spinner fa-spin me-2"></i>Signing in...</>
              ) : (
                <><i className="fa-solid fa-right-to-bracket me-2"></i>Login to Dashboard</>
              )}
            </button>

            <div className="text-center small text-muted">
              <Link to="/login" className="text-decoration-none text-secondary">
                <i className="fa-solid fa-arrow-left me-1"></i>Switch to Student Login
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
