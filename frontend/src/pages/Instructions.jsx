import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useExamGuard } from "../hooks/useExamGuard";
import { useSessionGuard } from "../hooks/useSessionGuard";
import FullscreenGate from "../components/FullscreenGate";
import LiveClock from "../components/LiveClock";
import ExamAPI from "../api";

// Minimum time the candidate gets to read the rules (seconds).
const READ_SECONDS = 10;

// Laptop / desktop only. Phones and tablets are blocked (iPads that report
// themselves as a Mac are caught by the touch-points check).
function isMobileDevice() {
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle|PlayBook|BlackBerry|IEMobile|Opera Mini|webOS/i.test(ua)) return true;
  if (navigator.userAgentData && navigator.userAgentData.mobile) return true;
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return true;
  return false;
}

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
  const mobileDevice = isMobileDevice();

  // ---- Camera check (permission + device) ----
  // This page only CHECKS that a camera is connected and allowed. It does no
  // face detection and shows no warnings — monitoring starts on the exam page.
  // Without a working camera the candidate cannot go past this page.
  // status: checking | ok | denied | nocamera | busy | unsupported | lost
  const [camStatus, setCamStatus] = useState("checking");
  const camStreamRef = useRef(null);

  function stopCamStream() {
    if (camStreamRef.current) {
      camStreamRef.current.getTracks().forEach((t) => t.stop());
      camStreamRef.current = null;
    }
  }

  function checkCamera() {
    stopCamStream();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCamStatus("unsupported");
      return;
    }
    setCamStatus("checking");
    navigator.mediaDevices
      .getUserMedia({ video: { width: 320, height: 240, facingMode: "user" }, audio: false })
      .then((s) => {
        camStreamRef.current = s;
        s.getVideoTracks().forEach((t) => {
          t.addEventListener("ended", () => setCamStatus("lost"));
        });
        setCamStatus("ok");
      })
      .catch((err) => {
        const name = err && err.name;
        if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") setCamStatus("nocamera");
        else if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") setCamStatus("busy");
        else setCamStatus("denied");
      });
  }

  useEffect(() => {
    if (!ready || mobileDevice) return undefined;
    checkCamera();
    function onDeviceChange() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
      navigator.mediaDevices.enumerateDevices().then((list) => {
        if (!list.some((d) => d.kind === "videoinput")) setCamStatus("lost");
      }).catch(() => {});
    }
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener("devicechange", onDeviceChange);
    }
    return () => {
      if (navigator.mediaDevices && navigator.mediaDevices.removeEventListener) {
        navigator.mediaDevices.removeEventListener("devicechange", onDeviceChange);
      }
      stopCamStream();
    };
  }, [ready, mobileDevice]);

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
  const camOk = camStatus === "ok";
  const canStart = ready && !mobileDevice && camOk && infoLoaded && readDone && !waitingForStart;

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

  // Phones and tablets cannot take the exam.
  if (mobileDevice) {
    return (
      <div style={{ background: "#0f172a", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', Tahoma, sans-serif", padding: 16 }}>
        <div style={{ background: "#fff", borderRadius: 14, maxWidth: 480, width: "100%", padding: 32, textAlign: "center", boxShadow: "0 20px 50px rgba(0,0,0,.4)" }}>
          <div style={{ fontSize: "2.4rem", color: "#dc2626" }}><i className="fa-solid fa-mobile-screen-button"></i></div>
          <h4 style={{ marginTop: 12, color: "#0f172a", fontWeight: 700 }}>Mobile devices are not allowed</h4>
          <p style={{ color: "#475569", lineHeight: 1.6 }}>
            This exam cannot be taken on a mobile phone or tablet. Please open the exam link on a laptop or desktop computer with a working webcam.
          </p>
        </div>
      </div>
    );
  }

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

  // No camera (or access not allowed) -> the candidate cannot continue.
  if (!camOk) {
    const msgs = {
      checking: ["Checking your camera…", "Please click \"Allow\" when the browser asks for camera access."],
      denied: ["Camera access is blocked", "Allow camera access for this site (click the camera / lock icon in the address bar → Allow), then press \"Try Again\"."],
      nocamera: ["No camera found", "No webcam is connected to this computer. Connect a working webcam, then press \"Try Again\". Without a camera you cannot take this exam."],
      busy: ["Camera is in use", "Another app or browser tab is using your camera. Close it, then press \"Try Again\"."],
      unsupported: ["Camera not supported", "This browser cannot access the camera. Open the exam link in the latest Google Chrome or Edge using the https:// address."],
      lost: ["Camera disconnected", "Your camera was turned off or unplugged. Reconnect it and press \"Try Again\". You cannot continue without a camera."]
    };
    const [title, text] = msgs[camStatus] || msgs.denied;
    return (
      <div style={{ background: "#0f172a", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', Tahoma, sans-serif", padding: 16 }}>
        <div style={{ background: "#fff", borderRadius: 14, maxWidth: 480, width: "100%", padding: 32, textAlign: "center", boxShadow: "0 20px 50px rgba(0,0,0,.4)" }}>
          <div style={{ fontSize: "2.4rem", color: camStatus === "checking" ? "#2a5298" : "#dc2626" }}>
            <i className={camStatus === "checking" ? "fa-solid fa-video" : "fa-solid fa-video-slash"}></i>
          </div>
          <h4 style={{ marginTop: 12, color: "#0f172a", fontWeight: 700 }}>{title}</h4>
          <p style={{ color: "#475569", lineHeight: 1.6 }}>{text}</p>
          <p style={{ color: "#64748b", fontSize: ".85rem" }}>A working, allowed camera is required for this proctored exam.</p>
          {camStatus !== "checking" && (
            <button className="btn btn-primary px-4" onClick={checkCamera}>
              <i className="fa-solid fa-rotate me-2"></i>Try Again
            </button>
          )}
        </div>
      </div>
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
                  <li className="mb-3"><strong>Saving Answers:</strong> When you click <strong>Save</strong> on a question, your answer is <strong>locked</strong> and can no longer be changed or cleared. If you have <strong>not saved</strong> a question yet, you can go back to it at any time using the question palette or the <strong>Previous</strong> button, and answer and save it then.</li>
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
                  <i className="fa-solid fa-video text-success me-1"></i>Camera connected&nbsp;&nbsp;
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