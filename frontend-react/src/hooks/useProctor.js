import { useEffect, useRef } from "react";
import ExamAPI from "../api";

const LOG_KEY = "proctorLog";

function logEvent(type, detail, flash) {
  try {
    const arr = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
    const last = arr[arr.length - 1];
    const now = Date.now();
    if (last && last.type === type && now - last.at < 8000) {
      flash(detail || type);
      return;
    }
    arr.push({ type, detail: detail || "", at: now, page: location.pathname });
    const trimmed = arr.length > 300 ? arr.slice(-300) : arr;
    localStorage.setItem(LOG_KEY, JSON.stringify(trimmed));
  } catch (e) { /* ignore */ }

  try {
    if (localStorage.getItem("studentToken")) {
      ExamAPI.logProctorEvent({ type, detail: detail || "", page: location.pathname }).catch(() => {});
    }
  } catch (e) { /* ignore */ }

  flash(detail || type);
}

/**
 * useProctor(active) — turns the candidate's camera on, shows a small live
 * preview box (bottom-right, matching the old exam-proctor.js UI), and
 * watches for a covered/dark camera, no face, multiple faces, tab
 * switching, and window blur — logging each to localStorage + the backend.
 */
export function useProctor(active) {
  const boxRef = useRef(null);
  const videoRef = useRef(null);
  const statusElRef = useRef(null);
  const warnElRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const detectorRef = useRef(null);
  const timerRef = useRef(null);
  const stoppedRef = useRef(false);
  const lastFrameRef = useRef(null);
  const noFaceStreakRef = useRef(0);
  const flashTimeoutRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;
    stoppedRef.current = false;

    function flash(msg) {
      const warnEl = warnElRef.current;
      if (!warnEl) return;
      warnEl.textContent = "⚠ " + msg;
      warnEl.style.display = "block";
      clearTimeout(flashTimeoutRef.current);
      flashTimeoutRef.current = setTimeout(() => {
        if (warnEl) warnEl.style.display = "none";
      }, 4000);
    }

    function setStatus(ok, text) {
      const box = boxRef.current;
      const statusEl = statusElRef.current;
      if (!box || !statusEl) return;
      box.style.borderColor = ok ? "#10b981" : "#dc2626";
      statusEl.innerHTML =
        '<span style="width:8px;height:8px;border-radius:50%;background:' +
        (ok ? "#10b981" : "#dc2626") + ';display:inline-block"></span>' + text;
    }

    function buildUI() {
      const box = document.createElement("div");
      box.id = "proctorCam";
            box.style.cssText =
        "position:fixed;right:14px;top:70px;z-index:99998;width:190px;border-radius:10px;" +
        "overflow:hidden;background:#0f172a;box-shadow:0 6px 22px rgba(0,0,0,.35);" +
        "font-family:'Segoe UI',Tahoma,sans-serif;border:2px solid #10b981;";

      const video = document.createElement("video");
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.style.cssText = "display:block;width:100%;height:140px;object-fit:cover;background:#000;transform:scaleX(-1);";

      const statusEl = document.createElement("div");
      statusEl.style.cssText = "padding:5px 8px;font-size:.72rem;font-weight:700;color:#e2e8f0;display:flex;align-items:center;gap:6px;";
      statusEl.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#10b981;display:inline-block"></span>Proctoring active';

      const warnEl = document.createElement("div");
      warnEl.style.cssText = "display:none;padding:5px 8px;font-size:.7rem;font-weight:700;background:#dc2626;color:#fff;";

      box.appendChild(video);
      box.appendChild(statusEl);
      box.appendChild(warnEl);
      document.body.appendChild(box);

      boxRef.current = box;
      videoRef.current = video;
      statusElRef.current = statusEl;
      warnElRef.current = warnEl;
    }

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = ctxRef.current;
      if (stoppedRef.current || !video || video.readyState < 2 || !ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      let data;
      try {
        data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      } catch (e) {
        return;
      }

      let sum = 0;
      const px = data.data;
      for (let i = 0; i < px.length; i += 40) sum += (px[i] + px[i + 1] + px[i + 2]) / 3;
      const avg = sum / (px.length / 40);
      if (avg < 18) {
        setStatus(false, "Camera covered");
        logEvent("camera_covered", "Camera view is dark or covered", flash);
        return;
      }

      if (detectorRef.current) {
        detectorRef.current
          .detect(video)
          .then((faces) => {
            if (!faces || faces.length === 0) {
              noFaceStreakRef.current++;
              if (noFaceStreakRef.current >= 2) {
                setStatus(false, "No face detected");
                logEvent("no_face", "Candidate not visible in camera", flash);
              }
            } else if (faces.length > 1) {
              noFaceStreakRef.current = 0;
              setStatus(false, "Multiple faces");
              logEvent("multiple_faces", faces.length + " people detected in frame", flash);
            } else {
              noFaceStreakRef.current = 0;
              setStatus(true, "Proctoring active");
            }
          })
          .catch(() => {});
      } else {
        if (lastFrameRef.current) {
          let diff = 0;
          let n = 0;
          const last = lastFrameRef.current;
          for (let j = 0; j < px.length; j += 40) {
            diff += Math.abs(px[j] - last[j]);
            n++;
          }
          const motion = diff / n;
          if (motion > 45) logEvent("sudden_movement", "Large movement detected in camera", flash);
        }
        lastFrameRef.current = new Uint8ClampedArray(px);
        setStatus(true, "Proctoring active");
      }
    }

    function beginAnalysis() {
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 120;
      canvasRef.current = canvas;
      ctxRef.current = canvas.getContext("2d", { willReadFrequently: true });

      if (typeof window.FaceDetector === "function") {
        try {
          detectorRef.current = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 5 });
        } catch (e) {
          detectorRef.current = null;
        }
      }

      clearInterval(timerRef.current);
      timerRef.current = setInterval(tick, 2000);
    }

    function retry() {
      if (stoppedRef.current) return;
      streamRef.current = null;
      clearInterval(timerRef.current);
      setTimeout(start, 5000);
    }

    function start() {
      if (streamRef.current || stoppedRef.current) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        logEvent("camera_unsupported", "Camera not supported by this browser", flash);
        return;
      }
      if (!boxRef.current) buildUI();
      navigator.mediaDevices
        .getUserMedia({ video: { width: 320, height: 240, facingMode: "user" }, audio: false })
        .then((s) => {
          streamRef.current = s;
          if (videoRef.current) videoRef.current.srcObject = s;
          setStatus(true, "Proctoring active");
          s.getVideoTracks().forEach((t) => {
            t.addEventListener("ended", () => {
              if (!stoppedRef.current) {
                setStatus(false, "Camera stopped");
                logEvent("camera_stopped", "Camera was turned off", flash);
                retry();
              }
            });
          });
          beginAnalysis();
        })
        .catch((err) => {
          setStatus(false, "Camera blocked");
          logEvent("camera_denied", "Camera access denied (" + (err && err.name) + ")", flash);
          retry();
        });
    }

    function onVisibility() {
      if (document.hidden && !stoppedRef.current) {
        logEvent("tab_hidden", "Candidate switched away from the exam", flash);
      }
    }
    function onBlur() {
      if (!stoppedRef.current) logEvent("window_blur", "Exam window lost focus", flash);
    }
    function onPageHide() {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    }

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pagehide", onPageHide);

    start();

    return () => {
      stoppedRef.current = true;
      clearInterval(timerRef.current);
      clearTimeout(flashTimeoutRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pagehide", onPageHide);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (boxRef.current && boxRef.current.parentNode) {
        boxRef.current.parentNode.removeChild(boxRef.current);
      }
      boxRef.current = null;
    };
  }, [active]);
}
