import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import LiveClock from "../components/LiveClock";
import ExamAPI from "../api";

function formatDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-US", { weekday: "short", day: "2-digit", month: "long", year: "numeric" });
}
function formatTime(d) {
  if (!d) return "-";
  return new Date(d).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

export default function ExamAccessGate() {
  const { examId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const email = searchParams.get("email") || "";
  const code = searchParams.get("code") || "";

  const [exam, setExam] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [starting, setStarting] = useState(false);
  const [accessError, setAccessError] = useState("");

  useEffect(() => {
    ExamAPI.getPublicExamInfo(examId)
      .then(setExam)
      .catch((err) => setLoadError(err.message || "This exam link is no longer valid."));
  }, [examId]);

  function handleStart() {
    setStarting(true);
    setAccessError("");
    ExamAPI.verifyExamAccess(examId, { email, accessCode: code })
      .then((data) => {
        localStorage.setItem("studentToken", data.token);
        localStorage.setItem("candidateName", data.student.fullName);
        localStorage.setItem("candidateEmail", data.student.email);
        localStorage.setItem("candidatePhone", data.student.phone);
        localStorage.setItem("examStatus", "locked");
        // Hands off into the existing, unchanged instructions -> exam flow.
        navigate("/instructions", { replace: true });
      })
      .catch((err) => {
        setStarting(false);
        setAccessError(err.message || "Could not verify exam access. Please try again.");
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
    padding: "20px"
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

  if (!exam) return null;

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
          <h4 className="m-0 fw-bold">{exam.title}</h4>
          <span className="badge mt-1" style={{ background: "#e2e8f0", color: "#334155", fontSize: "0.8rem" }}>Exam Access</span>
        </div>

        <div style={{ padding: 30 }}>
          <table className="table table-borderless small mb-4">
            <tbody>
              <tr><td className="text-secondary">Email</td><td className="text-end fw-bold">{email || "-"}</td></tr>
              <tr><td className="text-secondary">Access code</td><td className="text-end fw-bold" style={{ letterSpacing: 1 }}>{code || "-"}</td></tr>
              <tr><td className="text-secondary">Exam date</td><td className="text-end">{formatDate(exam.examDate)}</td></tr>
              <tr><td className="text-secondary">Exam time</td><td className="text-end">{formatTime(exam.startTime)} – {formatTime(exam.endTime)}</td></tr>
            </tbody>
          </table>

          {accessError && (
            <div className="alert alert-danger small">{accessError}</div>
          )}

          <button type="button" disabled={starting} onClick={handleStart} className="btn w-100 fw-bold" style={{ backgroundColor: "#2a5298", color: "#fff", padding: 12, borderRadius: 8 }}>
            {starting ? (
              <><i className="fa-solid fa-spinner fa-spin me-2"></i>Verifying...</>
            ) : (
              <><i className="fa-solid fa-right-to-bracket me-2"></i>Start Exam</>
            )}
          </button>

          <div className="text-center small text-muted mt-3">
            Need help? Contact your exam administrator.
          </div>
        </div>
      </div>
    </div>
  );
}