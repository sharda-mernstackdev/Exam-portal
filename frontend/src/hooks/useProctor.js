import { useEffect, useRef } from "react";
import ExamAPI from "../api";

const LOG_KEY = "proctorLog";

// ---- Face monitoring (MediaPipe Face Landmarker) ----
// Loaded from a CDN the first time it is needed, only for pages that ask for
// face warnings. If it cannot be loaded (blocked network, old browser) the
// hook silently falls back to the older basic checks.
const MP_VERSION = "0.10.14";
const MP_BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`;
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MP_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let landmarkerPromise = null;
function loadLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = import(/* @vite-ignore */ MP_BUNDLE)
      .then(async (mod) => {
        const fileset = await mod.FilesetResolver.forVisionTasks(MP_WASM);
        return mod.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MP_MODEL },
          runningMode: "VIDEO",
          numFaces: 3
        });
      })
      .catch((e) => {
        landmarkerPromise = null;
        throw e;
      });
  }
  return landmarkerPromise;
}

// Tunable limits for the face warnings.
const MAX_WARNINGS = 3;          // warnings before the exam is auto-submitted
const HOLD_MS = 3500;            // a problem must last this long to count
const WARNING_COOLDOWN_MS = 12000; // minimum gap between two warnings
const CHECK_EVERY_MS = 600;      // how often the face is analysed
const YAW_MIN = 0.3;             // nose position across the face (0..1) —
const YAW_MAX = 0.7;             // outside this range = looking sideways
const CENTER_MIN = 0.12;         // face centre across the frame (0..1) —
const CENTER_MAX = 0.88;         // outside this range = moved to the side

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
 * useProctor(active, options) — turns the candidate's camera on, shows a small
 * live preview box (bottom-right, matching the old exam-proctor.js UI), and
 * watches for a covered/dark camera, no face, multiple faces, tab
 * switching, and window blur — logging each to localStorage + the backend.
 *
 * options.warnings (default false): when true (the exam page), face problems
 *   — candidate not visible / moved to the side / looking away, or another
 *   person in the camera — raise a visible WARNING (1 of 3, 2 of 3, 3 of 3).
 *   The third warning calls options.onLimit() (the exam page auto-submits).
 */
export function useProctor(active, options) {
  const optionsRef = useRef(options || {});
  optionsRef.current = options || {};

  const boxRef = useRef(null);
  const videoRef = useRef(null);
  const statusElRef = useRef(null);
  const warnElRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const detectorRef = useRef(null);
  const landmarkerRef = useRef(null);
  const timerRef = useRef(null);
  const stoppedRef = useRef(false);
  const lastFrameRef = useRef(null);
  const noFaceStreakRef = useRef(0);
  const flashTimeoutRef = useRef(null);
  const overlayRef = useRef(null);
  const overlayTimeoutRef = useRef(null);
  const warningCountRef = useRef(0);
  const lastWarningAtRef = useRef(0);
  const faceSeenRef = useRef(false);
  const badRef = useRef({ reason: null, since: 0 });
  const limitReachedRef = useRef(false);

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

    // ---- Big on-screen warning (WARNING n of 3) ----
    function showOverlay(title, message, final) {
      if (overlayRef.current && overlayRef.current.parentNode) {
        overlayRef.current.parentNode.removeChild(overlayRef.current);
      }
      clearTimeout(overlayTimeoutRef.current);
      const el = document.createElement("div");
      el.style.cssText =
        "position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.78);display:flex;" +
        "align-items:center;justify-content:center;font-family:'Segoe UI',Tahoma,sans-serif;";
      const card = document.createElement("div");
      card.style.cssText =
        "background:#fff;border-radius:14px;max-width:460px;width:90%;padding:28px;text-align:center;" +
        "box-shadow:0 20px 50px rgba(0,0,0,.45);border-top:6px solid " + (final ? "#dc2626" : "#f59e0b") + ";";
      const h = document.createElement("div");
      h.style.cssText = "font-size:1.35rem;font-weight:800;color:" + (final ? "#b91c1c" : "#b45309") + ";margin-bottom:8px;";
      h.textContent = title;
      const p = document.createElement("div");
      p.style.cssText = "color:#334155;font-size:.98rem;line-height:1.5;";
      p.textContent = message;
      card.appendChild(h);
      card.appendChild(p);
      if (!final) {
        const btn = document.createElement("button");
        btn.textContent = "OK, I understand";
        btn.style.cssText =
          "margin-top:18px;background:#0f172a;color:#fff;border:0;border-radius:8px;padding:10px 22px;" +
          "font-weight:700;cursor:pointer;";
        btn.onclick = () => {
          if (el.parentNode) el.parentNode.removeChild(el);
        };
        card.appendChild(btn);
      }
      el.appendChild(card);
      document.body.appendChild(el);
      overlayRef.current = el;
      if (!final) {
        overlayTimeoutRef.current = setTimeout(() => {
          if (el.parentNode) el.parentNode.removeChild(el);
        }, 7000);
      }
    }

    // One face problem has lasted long enough -> count it as a warning.
    function raiseWarning(reason, text) {
      const opts = optionsRef.current;
      if (!opts.warnings || limitReachedRef.current) return;
      const now = Date.now();
      if (now - lastWarningAtRef.current < WARNING_COOLDOWN_MS) return;
      lastWarningAtRef.current = now;
      warningCountRef.current += 1;
      const n = warningCountRef.current;
      logEvent("face_warning", `Warning ${n}/${MAX_WARNINGS}: ${text}`, flash);
      if (n >= MAX_WARNINGS) {
        limitReachedRef.current = true;
        showOverlay(
          `WARNING ${n} of ${MAX_WARNINGS} — Limit reached`,
          "You have received 3 camera warnings. Your exam is being submitted automatically.",
          true
        );
        setTimeout(() => {
          if (typeof opts.onLimit === "function") opts.onLimit();
        }, 2500);
      } else {
        showOverlay(
          `WARNING ${n} of ${MAX_WARNINGS}`,
          `${text} Please sit in front of the camera, face the screen and make sure only you are visible. ` +
            `After ${MAX_WARNINGS} warnings your exam will be submitted automatically.`,
          false
        );
      }
    }

    // `reason` = null when everything is fine, otherwise a problem key.
    // The problem must continue for HOLD_MS before it becomes a warning, so
    // a quick glance or a blink is never punished.
    function trackProblem(reason, text) {
      const bad = badRef.current;
      if (!reason) {
        bad.reason = null;
        return;
      }
      const now = Date.now();
      if (bad.reason !== reason) {
        bad.reason = reason;
        bad.since = now;
        return;
      }
      if (now - bad.since >= HOLD_MS) {
        raiseWarning(reason, text);
        bad.since = now; // next warning needs another full HOLD_MS
      }
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

    // Looks at one landmarker result and reports the problem (if any).
    function judgeFaces(result) {
      const faces = (result && result.faceLandmarks) || [];
      if (faces.length === 0) {
        if (!faceSeenRef.current) return; // still starting up
        setStatus(false, "No face detected");
        logEvent("no_face", "Candidate not visible in camera", flash);
        trackProblem("no_face", "You are not visible in the camera.");
        return;
      }
      if (faces.length > 1) {
        setStatus(false, "Multiple faces");
        logEvent("multiple_faces", faces.length + " people detected in frame", flash);
        trackProblem("multiple_faces", "More than one person is visible in the camera.");
        return;
      }
      faceSeenRef.current = true;

      const lm = faces[0];
      // 1 = nose tip, 234 / 454 = left / right edge of the face.
      const nose = lm[1];
      const edgeA = lm[234];
      const edgeB = lm[454];
      const left = Math.min(edgeA.x, edgeB.x);
      const right = Math.max(edgeA.x, edgeB.x);
      const width = right - left;
      const yaw = width > 0 ? (nose.x - left) / width : 0.5; // ~0.5 = facing the camera
      const centerX = (left + right) / 2;

      if (centerX < CENTER_MIN || centerX > CENTER_MAX) {
        setStatus(false, "Face off-centre");
        logEvent("face_off_center", "Candidate moved to the side of the camera", flash);
        trackProblem("off_center", "You have moved to the side of the camera.");
        return;
      }
      if (yaw < YAW_MIN || yaw > YAW_MAX) {
        setStatus(false, "Looking away");
        logEvent("looking_away", "Candidate is looking away from the screen", flash);
        trackProblem("looking_away", "You are looking away from the screen.");
        return;
      }
      setStatus(true, "Proctoring active");
      trackProblem(null);
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
        trackProblem("camera_covered", "Your camera is covered or too dark.");
        return;
      }

      // Preferred: MediaPipe face landmarks (works in every modern browser).
      if (landmarkerRef.current) {
        try {
          const result = landmarkerRef.current.detectForVideo(video, performance.now());
          judgeFaces(result);
        } catch (e) { /* skip this frame */ }
        return;
      }

      // Fallback 1: the browser's own FaceDetector (Chrome flag only).
      if (detectorRef.current) {
        detectorRef.current
          .detect(video)
          .then((faces) => {
            if (!faces || faces.length === 0) {
              noFaceStreakRef.current++;
              if (noFaceStreakRef.current >= 2) {
                setStatus(false, "No face detected");
                logEvent("no_face", "Candidate not visible in camera", flash);
                trackProblem("no_face", "You are not visible in the camera.");
              }
            } else if (faces.length > 1) {
              noFaceStreakRef.current = 0;
              setStatus(false, "Multiple faces");
              logEvent("multiple_faces", faces.length + " people detected in frame", flash);
              trackProblem("multiple_faces", "More than one person is visible in the camera.");
            } else {
              noFaceStreakRef.current = 0;
              setStatus(true, "Proctoring active");
              trackProblem(null);
            }
          })
          .catch(() => {});
      } else {
        // Fallback 2: only watch for sudden large movement.
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

      // Face warnings need the landmark model; load it in the background and
      // switch over to it as soon as it is ready.
      if (optionsRef.current.warnings) {
        loadLandmarker()
          .then((lm) => {
            if (!stoppedRef.current) landmarkerRef.current = lm;
          })
          .catch(() => { /* keep the basic fallback checks */ });
      }

      clearInterval(timerRef.current);
      timerRef.current = setInterval(tick, optionsRef.current.warnings ? CHECK_EVERY_MS : 2000);
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
                trackProblem("camera_stopped", "Your camera was turned off.");
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
      clearTimeout(overlayTimeoutRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pagehide", onPageHide);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (overlayRef.current && overlayRef.current.parentNode) {
        overlayRef.current.parentNode.removeChild(overlayRef.current);
      }
      overlayRef.current = null;
      if (boxRef.current && boxRef.current.parentNode) {
        boxRef.current.parentNode.removeChild(boxRef.current);
      }
      boxRef.current = null;
    };
  }, [active]);
}