import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useExamGuard } from "../hooks/useExamGuard";
import { useProctor } from "../hooks/useProctor";
import { useSessionGuard } from "../hooks/useSessionGuard";
import FullscreenGate from "../components/FullscreenGate";
import LiveClock from "../components/LiveClock";
import ExamAPI from "../api";

// Minimum time the candidate gets to read the rules (seconds).
const READ_SECONDS = 10;

function fmtCountdown(totalSec) {
  const t = Math.max(0, Math.ceil(totalSec));
  const h = Math.floor(t / 3600);
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
  const sec = String(t % 60).padStart(2, "0");
  return h > 0 ? `${String(h).padStart(2, "0")}:${m}:${sec}` : `${m}:${sec}`;
}

export default function Instructions() {
  const navigate = useNavigate();
  const { ready, candidateName } = useSessionGuard();
  const tabSwitchCountRef = useRef(0);

  function handleLockdownViolation() {
    tabSwitchCountRef.current++;
    if (tabSwitchCountRef.current >= 2) {
      alert("Violation Limit Reached! Returning to Login Screen.");
      localStorage.removeItem("examStatus");
      navigate("/login", { replace: true });
    } else {
      alert(`WARNING (${tabSwitchCountRef.current}/2): Leaving fullscreen or switching windows is prohibited!`);
    }
  }

  const { fullscreen, enter } = useExamGuard(ready, handleLockdownViolation);
  useProctor(ready);

  // ---- Timing ----
  // The exam opens at its scheduled start time, not 10 seconds after the
  // instructions appear. The candidate always gets at least READ_SECONDS to
  // read the rules; after that the page waits (with a live countdown) until
  // the scheduled start, then opens the test. The countdown uses the SERVER
  // clock (offset measured when the exam info is fetched), so a wrong clock
  // on the candidate's computer cannot start the exam early or late.
  const [nowMs, setNowMs] = useState(Date.now());
  const [startMs, setStartMs] = useState(null);
  const [infoLoaded, setInfoLoaded] = useState(false);
  const offsetRef = useRef(0); // serverTime - clientTime
  const readStartRef = useRef(null);

  useEffect(() => {
    if (!ready) return undefined;
    readStartRef.current = Date.now();
    const examId = localStorage.getItem("examId");
    if (!examId) {
      setInfoLoaded(true);
      return undefined;
    }
    const before = Date.now();
    ExamAPI.getPublicExamInfo(examId)
      .then((e) => {
        const after = Date.now();
        if (e && e.serverTime) {
          // Assume the response was produced halfway through the round trip.
          offsetRef.current = new Date(e.serverTime).getTime() - (before + after) / 2;
        }
        if (e && e.startTime) setStartMs(new Date(e.startTime).getTime());
      })
      .catch(() => { /* no schedule info -> plain reading countdown */ })
      .finally(() => setInfoLoaded(true));
    return undefined;
  }, [ready]);

  useEffect(() => {
    if (!ready) return undefined;
    const id = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(id);
  }, [ready]);

  const serverNow = nowMs + offsetRef.current;
  const readLeft = readStartRef.current ? Math.max(0, READ_SECONDS - (nowMs - readStartRef.current) / 1000) : READ_SECONDS;
  const startLeft = startMs ? Math.max(0, (startMs - serverNow) / 1000) : 0;
  const waitingForStart = startLeft > 0;
  const readDone = readLeft <= 0;
  const canStart = ready && infoLoaded && readDone && !waitingForStart;

  useEffect(() => {
    if (canStart) navigate("/dashboard", { replace: true });
  }, [canStart, navigate]);

  // Disable the browser Back button on this page too.
  useEffect(() => {
    if (!ready) return undefined;
    window.history.pushState(null, "", window.location.href);
    function onPopState() {
      window.history.pushState(null, "", window.location.href);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [ready]);

  // Anti-tab-switching monitor — shares the violation counter with leaving
  // fullscreen (handleLockdownViolation above).
  useEffect(() => {
    if (!ready) return undefined;
    function onVisibility() {
      if (document.hidden && localStorage.getItem("examStatus") === "locked") {
        handleLockdownViolation();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [ready, navigate]);

  if (!ready) return null;

  if (!fullscreen) {
    return (
      <FullscreenGate
        onEnter={enter}
        title="Exam Portal Locked"
        message="You must enable Fullscreen Mode to view exam instructions and proceed."
        buttonLabel="Enable Fullscreen & Proceed"
      />
    );
  }

  const timerLabel = waitingForStart ? "Exam Starts In" : "Auto Redirect In";
  const timerText = waitingForStart ? fmtCountdown(startLeft) : fmtCountdown(readLeft);
  const done = canStart;

  return (
    <div style={{ background: "#f1f5f9", fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", minHeight: "100vh", display: "flex", flexDirection: "column", userSelect: "none" }}>
      <nav className="navbar navbar-dark shadow-sm" style={{ backgroundColor: "#0f172a" }}>
        <div className="container">
          <span className="navbar-brand mb-0 h1">
            <i className="fa-solid fa-graduation-cap text-warning me-2"></i>Online Exam Portal
          </span>
          <LiveClock style={{ backgroundColor: "rgba(255,255,255,0.1)", padding: "4px 12px", borderRadius: 6, fontSize: "0.85rem", color: "#fde047" }} />
          <div className="text-white small">
            Candidate: <span className="text-warning fw-bold">{candidateName || "Guest"}</span>
          </div>
        </div>
      </nav>

      <div className="container my-auto py-4">
        <div className="row justify-content-center">
          <div className="col-lg-9">
            <div className="card" style={{ background: "#fff", borderRadius: 12, boxShadow: "0 5px 20px rgba(0,0,0,0.08)", border: "none" }}>
              <div className="card-header bg-white border-0 pt-4 px-4 d-flex justify-content-between align-items-center flex-wrap gap-2">
                <div>
                  <h3 className="mb-1">Welcome, <span style={{ color: "#2a5298", fontWeight: 600 }}>{candidateName || "Candidate"}</span>!</h3>
                  <p className="text-muted small mb-0">Please read all instructions carefully before the exam starts.</p>
                </div>
                <div className="p-2 px-3 text-center" style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a", fontSize: "1.1rem", borderRadius: 8 }}>
                  <div className="small fw-bold text-uppercase">{timerLabel}</div>
                  <div style={{ fontWeight: 700, color: done ? "#16a34a" : "#dc2626", fontSize: "1.3rem" }}>
                    {done ? (
                      <><i className="fa-solid fa-circle-check text-success me-1"></i>00:00</>
                    ) : (
                      <><i className="fa-regular fa-clock me-1"></i>{timerText}</>
                    )}
                  </div>
                </div>
              </div>

              <hr className="mx-4 my-2" />

              <div className="card-body px-4">
                <h5 className="text-danger fw-bold mb-3">
                  <i className="fa-solid fa-triangle-exclamation me-2"></i>Important Guidelines & Rules:
                </h5>

                <ol className="text-secondary ps-3" style={{ lineHeight: 1.6 }}>
                  <li className="mb-3"><strong>Reading Time:</strong> Please read these rules carefully while you wait. The test will open <strong>automatically at the scheduled exam start time</strong> — do not refresh or close this page.</li>
                  <li className="mb-3"><strong>Exam Duration & Format:</strong> The total test duration begins as soon as the test opens at the scheduled start time. All questions are multiple-choice.</li>
                  <li className="mb-3"><strong>Proctored Environment:</strong> Do not refresh the page, switch browser tabs, minimize the window, or close the browser during the exam. Any attempt to navigate away will result in immediate disqualification.</li>
                  <li className="mb-3"><strong>Device Requirements & Peripheral Restrictions:</strong> Ensure you have a stable internet connection. Use of external calculators, unauthorized secondary mobile devices, secondary monitors, or copy-pasting code/text is strictly prohibited.</li>
                  <li className="mb-3"><strong>Inspection & Developer Tools:</strong> Attempting to open Developer Console (<kbd>F12</kbd>, <kbd>Ctrl+Shift+I</kbd>), inspect elements, or alter DOM elements will trigger an automatic security lock and disqualify your attempt.</li>
                  <li className="mb-3"><strong>Navigation Lockdown:</strong> Screen lockdown will remain active throughout the test session. You will only be permitted to exit lockdown upon reaching the final Summary screen via the designated Exit button.</li>
                  <li className="mb-3"><strong>Auto-Submission:</strong> The test will automatically submit when the overall exam duration expires, or if multiple window violation alerts are triggered, regardless of unanswered questions.</li>
                </ol>

                <div className="alert alert-warning mt-4 small" role="alert">
                  <i className="fa-solid fa-circle-info me-2"></i>
                  <strong>Note:</strong> Keep your webcam centered and ensure your face remains visible. Ensure your microphone remains clear of background noise if proctoring is enabled by the administrator.
                </div>
              </div>

              <div className="card-footer bg-light p-3 px-4 d-flex justify-content-between align-items-center">
                <span className="text-muted small">
                  <i className="fa-solid fa-lock me-1"></i>Exam will begin automatically at the scheduled start time.
                </span>
                <span className="badge bg-primary px-3 py-2">
                  <i className="fa-solid fa-spinner fa-spin me-1"></i>{waitingForStart ? "Waiting for exam start..." : "Preparing Exam..."}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}