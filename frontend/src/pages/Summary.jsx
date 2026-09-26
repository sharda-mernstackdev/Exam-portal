import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useExamGuard } from "../hooks/useExamGuard";
import FullscreenGate from "../components/FullscreenGate";
import LiveClock from "../components/LiveClock";

export default function Summary() {
  const navigate = useNavigate();
  const { fullscreen, enter, exit } = useExamGuard(true);
  const [attempted, setAttempted] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [exited, setExited] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("examStatus") !== "locked" || !localStorage.getItem("studentToken")) {
      navigate("/login", { replace: true });
      return;
    }

    const rawData = localStorage.getItem("examSummaryData");
    if (!rawData) {
      alert("No exam data found.");
      localStorage.removeItem("examStatus");
      navigate("/login", { replace: true });
      return;
    }

    const { questions, userAnswers } = JSON.parse(rawData);
    let att = 0;
    let skip = 0;
    questions.forEach((q, idx) => {
      if (userAnswers[idx] !== undefined) att++;
      else skip++;
    });
    setAttempted(att);
    setSkipped(skip);
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleExit() {
    localStorage.removeItem("examStatus");
    localStorage.removeItem("examSummaryData");
    localStorage.removeItem("studentToken");
    exit();
    setExited(true);
  }

  if (!ready) return null;

  if (exited) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)", color: "#fff", zIndex: 100000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        <i className="fa-solid fa-desktop fa-5x text-success mb-4"></i>
        <h2 className="fw-bold mb-2">Examination Completed</h2>
        <p className="text-secondary fs-5 mb-4" style={{ maxWidth: 500 }}>
          Your responses have been successfully recorded in the administrator database. Your session is now terminated.
        </p>
        <div className="alert alert-dark border-secondary px-4 py-3 text-light">
          <i className="fa-solid fa-info-circle me-2 text-warning"></i>
          You may now safely close this browser window or tab.
        </div>
      </div>
    );
  }

  if (!fullscreen) {
    return (
      <FullscreenGate
        onEnter={enter}
        title="Summary View Locked"
        message="You must remain in Fullscreen Mode to view your final summary report."
        buttonLabel="Enable Fullscreen & View Summary"
      />
    );
  }

  const candidateName = localStorage.getItem("candidateName") || "Candidate";

  return (
    <div style={{ background: "#f8fafc", fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", minHeight: "100vh", paddingBottom: 40, userSelect: "none" }}>
      <nav className="navbar navbar-dark bg-dark shadow-sm">
        <div className="container">
          <span className="navbar-brand mb-0 h1">
            <i className="fa-solid fa-graduation-cap text-warning me-2"></i>Online Exam Portal
          </span>
          <LiveClock style={{ backgroundColor: "rgba(255,255,255,0.1)", padding: "4px 12px", borderRadius: 6, fontSize: "0.85rem", color: "#38bdf8" }} />
          <span className="text-white small">{candidateName}</span>
        </div>
      </nav>

      <div className="container my-5">
        <div className="row justify-content-center">
          <div className="col-lg-8">
            <div className="card p-5 mb-4 text-center" style={{ border: "none", borderRadius: 12, boxShadow: "0 5px 20px rgba(0,0,0,0.05)" }}>
              <i className="fa-solid fa-circle-check fa-4x text-success mb-3"></i>
              <h2 className="fw-bold">Exam Submitted Successfully!</h2>
              <p className="text-muted fs-5 mb-0">Here is your overall submission summary.</p>
            </div>

            <div className="row g-4 mb-5 justify-content-center">
              <div className="col-md-6">
                <div className="bg-white border shadow-sm text-center" style={{ borderRadius: 12, padding: 25 }}>
                  <h1 className="fw-bold text-primary display-4">{attempted}</h1>
                  <span className="text-muted fw-bold text-uppercase">Total Attempted</span>
                </div>
              </div>
              <div className="col-md-6">
                <div className="bg-white border shadow-sm text-center" style={{ borderRadius: 12, padding: 25 }}>
                  <h1 className="fw-bold text-secondary display-4">{skipped}</h1>
                  <span className="text-muted fw-bold text-uppercase">Unattempted</span>
                </div>
              </div>
            </div>

            <div className="text-center mt-2">
              <button className="btn btn-danger btn-lg px-5 py-3 shadow fs-5 rounded-pill fw-bold" onClick={handleExit}>
                <i className="fa-solid fa-power-off me-2"></i>Exit Exam Session
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
