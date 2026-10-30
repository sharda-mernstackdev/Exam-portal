import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useExamGuard } from "../hooks/useExamGuard";
import { useProctor } from "../hooks/useProctor";
import FullscreenGate from "../components/FullscreenGate";
import LiveClock from "../components/LiveClock";
import ExamAPI from "../api";

const EXAM_DURATION_MIN = 45;

// Laptop / desktop only. Phones and tablets are blocked (iPads that report
// themselves as a Mac are caught by the touch-points check).
function isMobileDevice() {
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle|PlayBook|BlackBerry|IEMobile|Opera Mini|webOS/i.test(ua)) return true;
  if (navigator.userAgentData && navigator.userAgentData.mobile) return true;
  if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return true;
  return false;
}

const CAM_MESSAGES = {
  checking: ["Checking your camera...", "Please click Allow when the browser asks for camera and microphone permission."],
  denied: ["Camera permission is blocked", "Allow camera access for this site in the browser (lock icon in the address bar), then click Check Camera Again."],
  nocamera: ["No camera found", "Connect a webcam to this computer, then click Check Camera Again."],
  busy: ["Camera is in use by another app", "Close other apps or tabs using the camera, then click Check Camera Again."],
  unsupported: ["Camera is not supported", "Please use the latest Chrome or Edge on a laptop or desktop."],
  lost: ["Camera was disconnected", "Reconnect your camera, then click Check Camera Again."]
};

// ---- Per-question answer drafts (survive a refresh / re-login on this browser) ----
// Every draft is stored under: round 2 + candidate (id from the signed-in
// token) + the question's own id. Nothing is keyed by the question's
// position, so one question's answer can never land in another's.
function getDraftOwner() {
  try {
    const t = localStorage.getItem("studentToken") || "";
    const payload = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return String(payload.id || payload.email || "");
  } catch (e) {
    return String(localStorage.getItem("candidateEmail") || "");
  }
}
function draftAnswerKey(owner, qid) { return `r2ans:${owner}:${qid}`; }
function readDraft(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function writeDraft(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* storage full / blocked: memory copy still works */ }
}
function clearDrafts(owner) {
  try {
    const drop = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.indexOf(`r2ans:${owner}:`) === 0 || k.indexOf(`r2code:${owner}:`) === 0 || k.indexOf(`r2lang:${owner}:`) === 0)) drop.push(k);
    }
    drop.forEach((k) => localStorage.removeItem(k));
  } catch (e) { /* ignore */ }
}

export default function SecondLevelExam() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState("loading"); // loading | start | exam | result
  const violationCountRef = useRef(0);

  // The fullscreen listener inside useExamGuard is registered once, so it would
  // keep calling the FIRST render's handler (phase still "loading") and every
  // exit from fullscreen (the browser's cross/X button, Esc...) was silently
  // ignored. These refs always hold the latest values, and the guard is given a
  // small wrapper that calls the latest handler.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const questionsRef = useRef(null);
  const submittedRef = useRef(false);
  const lastViolationAtRef = useRef(0);
  const permGraceUntilRef = useRef(0); // no violation is counted until this time (ms)
  const micOkRef = useRef(false);
  const lockdownHandlerRef = useRef(null);

  function handleLockdownViolation(kind) {
    if (phaseRef.current !== "exam") return; // don't penalize before the exam starts
    if (submittedRef.current) return;
    // The browser's microphone permission box can drop fullscreen / blur the
    // page by itself. That is not the candidate's fault: no violation then.
    if (Date.now() < permGraceUntilRef.current) return;
    // One qualifying action = one violation (several events can fire for it).
    const now = Date.now();
    if (now - lastViolationAtRef.current < 1500) return;
    lastViolationAtRef.current = now;

    violationCountRef.current++;
    const n = violationCountRef.current;
    const what = kind === "tab" ? "Switched tab/window" : "Exited fullscreen (cross/X button or Esc)";
    try {
      ExamAPI.logProctorEvent({
        type: kind === "tab" ? "round2_tab_switch" : "round2_fullscreen_exit",
        detail: `Round 2 violation ${n}/2: ${what}`,
        page: location.pathname,
      }).catch(() => {});
    } catch (e) { /* ignore */ }

    if (n >= 2) {
      alert("VIOLATION LIMIT EXCEEDED: Auto-submitting your Round 2 attempt!");
      submitExam(true, "violation");
    } else {
      alert(`WARNING (${n}/2): Leaving fullscreen or switching windows is forbidden!`);
    }
  }
  lockdownHandlerRef.current = handleLockdownViolation;

  const { fullscreen, enter } = useExamGuard(true, () => {
    if (lockdownHandlerRef.current) lockdownHandlerRef.current("fullscreen");
  });

  const [candidateName, setCandidateName] = useState("");
  const [questions, setQuestions] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(EXAM_DURATION_MIN * 60);
  // The SERVER fixes the deadline (when Begin is pressed) and tells this page
  // which mode applies; the page only counts down to that deadline. The mode
  // comes from the exam's own configuration on the server (never guessed here):
  //  - "campus": submitted automatically at 0:00 (and by the server if needed);
  //  - "online": the candidate must submit manually (Complete Exam) before the
  //    deadline; nothing is submitted for them, and after the deadline the
  //    server refuses the submission.
  // null = the server could not be reached; the page then behaves as it
  // originally did (local timer, auto-submit at 0:00).
  const [mode, setMode] = useState(null);
  const campus = mode === "campus";
  const onlineMode = mode === "online";
  const [serverClock, setServerClock] = useState(false);
  const [resultKind, setResultKind] = useState("submitted"); // submitted | expired
  const expiryPingedRef = useRef(false);
  const [durationMin, setDurationMin] = useState(EXAM_DURATION_MIN);
  const deadlineRef = useRef(null);   // server deadline (ms, server clock)
  const offsetRef = useRef(0);        // server clock minus this computer's clock
  const beginBusyRef = useRef(false);
  const draftBusyRef = useRef(false);
  const lastSavedRef = useRef("");
  const [resultLine, setResultLine] = useState("");
  const [, setResultScore] = useState({ passed: 0, total: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [clipMsg, setClipMsg] = useState("");
  const clipMsgTimerRef = useRef(null);
  const [savedMsg, setSavedMsg] = useState(false);
  const savedTimerRef = useRef(null);
  const lastClipLogRef = useRef(0);

  // Source of truth for the candidate's answers: answersRef.current[questionId]
  // = the text typed (text question) or the chosen option number as text (MCQ,
  // "" = nothing chosen). It is written on every keystroke / click (see
  // setAnswer), keyed by the question's own id - never by its position - so one
  // question's answer can never land in another's.
  const answersRef = useRef({}); // q.id -> answer
  const draftOwnerRef = useRef("");
  const visitedRef = useRef({}); // q.id -> true once the question was opened
  const [, forceRender] = useState(0);
  const rerender = () => forceRender((n) => n + 1);

  // Camera + microphone monitoring during the exam. Background voice and
  // camera movement only show a red note under the camera box — they never
  // end the exam.
  useProctor(phase === "exam", { voice: true });

  // ---- Camera check on the start page (permission + device) ----
  // Only checks that a camera is connected and allowed; no face detection here.
  // status: checking | ok | denied | nocamera | busy | unsupported | lost
  const mobileDevice = isMobileDevice();
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
    permGraceUntilRef.current = Date.now() + 60000; // while permission boxes are open
    navigator.mediaDevices
      .getUserMedia({ video: { width: 320, height: 240, facingMode: "user" }, audio: false })
      .then((s) => {
        camStreamRef.current = s;
        s.getVideoTracks().forEach((t) => t.addEventListener("ended", () => setCamStatus("lost")));
        // Microphone permission (optional) - asked here, on the start page, so the
        // browser does not pop up its permission box in the middle of the exam.
        return navigator.mediaDevices
          .getUserMedia({ audio: true, video: false })
          .then((a) => { micOkRef.current = true; a.getTracks().forEach((t) => t.stop()); })
          .catch(() => { micOkRef.current = false; /* microphone is optional */ })
          .then(() => {
            setCamStatus("ok");
            permGraceUntilRef.current = Date.now() + 4000;
          });
      })
      .catch((err) => {
        permGraceUntilRef.current = Date.now() + 4000;
        const name = err && err.name;
        if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") setCamStatus("nocamera");
        else if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") setCamStatus("busy");
        else setCamStatus("denied");
      });
  }

  useEffect(() => {
    if (phase !== "start" || mobileDevice) return undefined;
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
      stopCamStream(); // release the camera so the exam page can open it
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, mobileDevice]);

  // Anti-tab-switching monitor — shares the violation counter with leaving
  // fullscreen (handleLockdownViolation above).
  useEffect(() => {
    if (phase !== "exam") return undefined;
    function onVisibility() {
      if (document.hidden && localStorage.getItem("examStatus") === "locked") {
        handleLockdownViolation("tab");
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Session guard + round1-pass check + question fetch
  useEffect(() => {
    if (localStorage.getItem("examStatus") !== "locked" || !localStorage.getItem("studentToken")) {
      navigate("/login", { replace: true });
      return;
    }
    ExamAPI.verifyStudent()
      .then((v) => {
        setCandidateName(v.student.name);
        return ExamAPI.myLatestSubmission();
      })
      .then((submission) => {
        if (submission.round1Status !== "PASS") {
          alert("You need to pass Round 1 before attempting Round 2.");
          navigate("/login", { replace: true });
          return Promise.reject(new Error("round1 not passed"));
        }
        return ExamAPI.getCodingQuestions();
      })
      .then((rawQs) => {
        if (!rawQs) return;
        if (!rawQs.length) {
          alert("No Round 2 questions are available right now. Please contact the administrator.");
          navigate("/login", { replace: true });
          return;
        }
        // The server sends MongoDB's `_id`. Give every question one stable
        // string id (never its array position) and use it everywhere.
        const qs = rawQs.map((q) => ({ ...q, id: String(q._id || q.id) }));
        const owner = getDraftOwner();
        draftOwnerRef.current = owner;
        qs.forEach((q) => {
          const draft = readDraft(draftAnswerKey(owner, q.id));
          answersRef.current[q.id] = draft !== null ? draft : "";
        });
        questionsRef.current = qs;
        setQuestions(qs);
        setCurrentIndex(0);
        // Which mode / duration applies (and the deadline, if this exam was
        // already started and the page was refreshed). Not fatal if it fails.
        return ExamAPI.getSecondLevelStatus()
          .then(applyTiming)
          .catch(() => { /* keep the default local timer */ })
          .then(() => setPhase("start"));
      })
      .catch((err) => {
        if (err.message === "round1 not passed") return;
        localStorage.removeItem("examStatus");
        localStorage.removeItem("studentToken");
        alert(err.message || "Your session has expired. Please log in again.");
        navigate("/login", { replace: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Saves the answer of ONE question (memory + draft on this browser).
  function setAnswer(qid, value) {
    answersRef.current[qid] = value;
    writeDraft(draftAnswerKey(draftOwnerRef.current, qid), value);
    rerender();
  }

  // Shows question `idx`.
  function loadQuestionInto(idx) {
    if (!questions[idx]) return;
    setCurrentIndex(idx);
  }

  // Reads the server's timer information (see GET /second-level/status).
  function applyTiming(t) {
    if (!t) return;
    setMode(t.mode || (t.campus ? "campus" : "online"));
    setDurationMin(Number(t.durationMinutes) || EXAM_DURATION_MIN);
    if (t.started && t.deadlineAt) {
      offsetRef.current = Date.parse(t.serverTime) - Date.now();
      deadlineRef.current = Date.parse(t.deadlineAt);
      setServerClock(true);
      setTimeLeft(Math.max(0, Number(t.remainingSeconds) || 0));
    } else {
      setTimeLeft((Number(t.durationMinutes) || EXAM_DURATION_MIN) * 60);
    }
  }

  // The server marks the start time (once). Pressing Begin again after a
  // refresh gets the SAME deadline back, so the clock cannot be restarted.
  function handleBegin() {
    if (mobileDevice || camStatus !== "ok" || beginBusyRef.current) return;
    beginBusyRef.current = true;
    ExamAPI.startSecondLevel()
      .then((t) => {
        applyTiming(t);
        // If the microphone was not allowed yet, the browser may ask once more
        // when the exam starts: do not count that as a violation.
        if (!micOkRef.current) permGraceUntilRef.current = Date.now() + 10000;
        setPhase("exam");
      })
      .catch((err) => {
        if (err.status === 401 || err.status === 409 || (err.status === 403 && err.data && err.data.expired)) {
          clearDrafts(draftOwnerRef.current);
          localStorage.removeItem("examStatus");
          localStorage.removeItem("studentToken");
          alert(err.message || "Your session has ended.");
          navigate("/login", { replace: true });
          return;
        }
        alert(err.message || "Could not start the exam. Please check your connection and try again.");
      })
      .finally(() => { beginBusyRef.current = false; });
  }

  // The server has already finalized this attempt (time expired / already
  // submitted): show the result screen instead of letting the candidate
  // continue. Safe to call more than once.
  function showServerFinalized(data) {
    if (submittedRef.current && phaseRef.current === "result") return;
    submittedRef.current = true;
    clearDrafts(draftOwnerRef.current);
    setResultLine(
      data && data.autoSubmitted
        ? "Time is up! Your exam time has expired and your exam was submitted automatically."
        : (data && data.message) || "Your Round 2 exam has been submitted."
    );
    setResultScore(null);
    setResultKind("submitted");
    setSubmitting(false);
    setPhase("result");
  }

  // Online mode: the deadline passed and the exam was not submitted in time.
  // The server refuses it; nothing was submitted for the candidate.
  function showExpired(message) {
    submittedRef.current = true;
    setResultLine(message || "Your Round 2 time is over. This exam had to be submitted manually before the deadline, so it can no longer be submitted.");
    setResultScore(null);
    setResultKind("expired");
    setSubmitting(false);
    setPhase("result");
  }

  // Timer - fallback when the server's deadline is not known: the original
  // local countdown.
  useEffect(() => {
    if (phase !== "exam" || serverClock || timeLeft <= 0) return undefined;
    const id = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(id);
  }, [phase, timeLeft, serverClock]);

  // Timer - counts down to the SERVER's deadline, using the server's clock, so
  // refreshing the page or changing this computer's clock does not change the
  // time left (Campus and Online mode).
  useEffect(() => {
    if (phase !== "exam" || !serverClock) return undefined;
    function tick() {
      if (!deadlineRef.current) return;
      const rem = Math.max(0, Math.ceil((deadlineRef.current - (Date.now() + offsetRef.current)) / 1000));
      setTimeLeft(rem);
    }
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [phase, serverClock]);

  // Time is up.
  //  - Campus (or unknown mode): submit automatically. submitExam can only run
  //    once (see submittedRef), however many times this effect fires.
  //  - Online: NOTHING is submitted. The candidate had to press Complete Exam
  //    before the deadline; the editor locks and the server refuses any later
  //    submission. A single quiet request tells the server the deadline was
  //    missed (it only records that in the proctor log).
  useEffect(() => {
    if (phase !== "exam" || timeLeft > 0) return;
    if (onlineMode) {
      if (!expiryPingedRef.current) {
        expiryPingedRef.current = true;
        setTimeout(() => { ExamAPI.getSecondLevelStatus().catch(() => {}); }, 12000);
      }
      return;
    }
    submitExam(true, "time");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, timeLeft, onlineMode]);

  // Campus mode: every 10 s send the server the current answer of every
  // question. If the browser dies before the deadline, the server finalizes
  // the exam from the latest copy it received.
  useEffect(() => {
    if (phase !== "exam" || !campus) return undefined;
    function save() {
      if (submittedRef.current || draftBusyRef.current || !questionsRef.current) return;
      const answers = questionsRef.current.map((qq) => ({
        questionId: qq.id,
        language: qq.type,
        code: answersRef.current[qq.id] || ""
      }));
      const snap = JSON.stringify(answers);
      if (snap === lastSavedRef.current) return;
      draftBusyRef.current = true;
      ExamAPI.saveSecondLevelDraft({ answers })
        .then(() => { lastSavedRef.current = snap; })
        .catch((err) => {
          if (err.status === 409 && err.data && err.data.completed) showServerFinalized(err.data);
          // other errors (network): the next tick tries again
        })
        .finally(() => { draftBusyRef.current = false; });
    }
    save();
    const id = setInterval(save, 10000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, campus]);

  // Once time is up (or the exam is being submitted) nothing can be changed.
  const locked = submitting || (phase === "exam" && timeLeft <= 0);

  function handleNext() {
    if (currentIndex < questions.length - 1) loadQuestionInto(currentIndex + 1);
  }
  function handlePrev() {
    if (currentIndex > 0) loadQuestionInto(currentIndex - 1);
  }
  // Save: the answer is already kept (in memory + on this browser) on every key /
  // click, so this just writes the current answer once more and shows "Saved".
  // It does not lock the answer - it can still be changed before Complete Exam.
  function handleSave() {
    if (locked || !questions) return;
    const cur = questions[currentIndex];
    writeDraft(draftAnswerKey(draftOwnerRef.current, cur.id), answersRef.current[cur.id] || "");
    setSavedMsg(true);
    clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSavedMsg(false), 2000);
  }

  // ---- No copy / cut / paste in the answer box ----
  // The answer must be typed by the candidate. This blocks the ordinary
  // clipboard routes inside the answer box itself (keyboard shortcuts, the
  // right-click menu, the browser menu, drag-and-drop of text, and a paste that
  // arrives as an input event). Typing, selecting, Ctrl/Cmd+A, undo/redo and
  // Submit are untouched. A browser cannot stop every
  // possible way of getting text in (e.g. a typing-automation tool or
  // another device), so the server-side checks and the proctoring log stay
  // in place; each blocked attempt is also recorded in the proctor log.
  function clipboardBlocked(what) {
    setClipMsg("Copy, cut and paste are disabled. Please type your answer.");
    clearTimeout(clipMsgTimerRef.current);
    clipMsgTimerRef.current = setTimeout(() => setClipMsg(""), 3000);
    const now = Date.now();
    if (now - lastClipLogRef.current > 8000) {
      lastClipLogRef.current = now;
      try {
        ExamAPI.logProctorEvent({ type: "clipboard_blocked", detail: "Tried to " + what + " in the answer box", page: location.pathname }).catch(() => {});
      } catch (e) { /* ignore */ }
    }
  }

  function blockClipboardEvent(what) {
    return (e) => {
      e.preventDefault();
      e.stopPropagation();
      clipboardBlocked(what);
    };
  }

  function handleAnswerChange(e) {
    if (locked) return;
    // A paste / drop / cut that slipped past the handlers above shows up here
    // as an input event of that type: ignore it (the controlled textarea
    // then keeps its previous text).
    const t = e.nativeEvent && e.nativeEvent.inputType;
    if (t === "insertFromPaste" || t === "insertFromPasteAsQuotation" || t === "insertFromDrop" || t === "insertFromYank" || t === "deleteByCut") {
      clipboardBlocked(t === "deleteByCut" ? "cut" : "paste");
      return;
    }
    setAnswer(questions[currentIndex].id, e.target.value);
  }

  function handleAnswerKeyDown(e) {
    if (locked) return;
    const key = (e.key || "").toLowerCase();
    const mod = e.ctrlKey || e.metaKey; // Ctrl on Windows/Linux, Cmd on macOS
    if (mod && !e.altKey && (key === "c" || key === "v" || key === "x")) {
      e.preventDefault();
      e.stopPropagation();
      clipboardBlocked(key === "c" ? "copy" : key === "x" ? "cut" : "paste");
      return;
    }
    // Older shortcuts for the same actions.
    if ((e.ctrlKey && key === "insert") || (e.shiftKey && key === "insert") || (e.shiftKey && key === "delete")) {
      e.preventDefault();
      e.stopPropagation();
      clipboardBlocked(e.ctrlKey ? "copy" : e.shiftKey && key === "delete" ? "cut" : "paste");
    }
  }

  function submitExam(auto, reason) {
    const qs = questionsRef.current || questions;
    if (!qs || submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    let totalPassed = 0, totalCases = qs.length;
    // Every answer is sent with ITS OWN question id. The marks are worked out by
    // the server; nothing about correctness is decided here.
    const answers = qs.map((q) => ({
      questionId: q.id,
      title: q.title,
      code: answersRef.current[q.id] || "",
      language: q.type
    }));

    ExamAPI.submitSecondLevel({ answers, auto: !!auto, reason: reason || "" })
      .then((saved) => {
        // The server marks the answers: show its numbers.
        if (saved && Array.isArray(saved.answers) && saved.answers.length) {
          totalPassed = saved.answers.reduce((n, a) => n + (Number(a.passed) || 0), 0);
          totalCases = saved.answers.reduce((n, a) => n + (Number(a.total) || 0), 0);
        }
        clearDrafts(draftOwnerRef.current);
        setResultLine(
          reason === "time"
            ? "Time is up! Your exam time has expired and your exam was submitted automatically."
            : auto
              ? "Your exam was submitted automatically because of rule violations."
              : "Your answers have been submitted."
        );
        setResultScore({ passed: totalPassed, total: totalCases });
        setPhase("result");
      })
      .catch((err) => {
        submittedRef.current = false;
        // 409 = the exam is already finalized (the server closed it at the
        // deadline, or another request submitted first): show that, don't retry.
        if (err.status === 409) {
          showServerFinalized({ ...(err.data || {}), autoSubmitted: (err.data && err.data.autoSubmitted) || reason === "time" });
          return;
        }
        // 403 expired = Online mode and the deadline has passed.
        if (err.status === 403 && err.data && err.data.expired) {
          showExpired(err.data.message);
          return;
        }
        if (err.status === 401) {
          setSubmitting(false);
          alert(err.message || "Your session has ended. Please log in again.");
          return;
        }
        // Network problem. When the time is up the exam must still be handed
        // in, so keep retrying every 3 s (the server also closes the exam
        // itself shortly after the deadline, from the answers it already has).
        if (reason === "time" && !(err.status >= 400 && err.status < 500)) {
          setTimeout(() => submitExam(true, "time"), 3000);
          return;
        }
        setSubmitting(false);
        alert(err.message || "Could not submit your Round 2 attempt. Please check your connection and try again.");
      });
  }

  if (phase === "loading") return null;

  if (!fullscreen) {
    return (
      <FullscreenGate
        onEnter={enter}
        title="Exam Session Locked"
        message="Fullscreen mode is required for test integrity."
        buttonLabel="Enable Fullscreen & Resume"
      />
    );
  }

  const q = questions ? questions[currentIndex] : null;
  const minutes = String(Math.floor(timeLeft / 60)).padStart(2, "0");
  const seconds = String(timeLeft % 60).padStart(2, "0");

  // Question palette (same idea as Round 1): answered / not answered (opened but
  // empty) / not visited.
  if (q) visitedRef.current[q.id] = true;
  const isAnswered = (qq) => String(answersRef.current[qq.id] || "").trim() !== "";
  function stateOf(qq, idx) {
    if (isAnswered(qq)) return "answered";
    if (idx === currentIndex || visitedRef.current[qq.id]) return "not-answered";
    return "not-visited";
  }
  const counts = { answered: 0, notAnswered: 0, notVisited: 0 };
  if (questions) {
    questions.forEach((qq, idx) => {
      const st = stateOf(qq, idx);
      if (st === "answered") counts.answered++;
      else if (st === "not-answered") counts.notAnswered++;
      else counts.notVisited++;
    });
  }

  return (
    <div style={{ background: "#f4f6f9", fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", userSelect: "none", height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {phase === "exam" && timeLeft <= 0 && !(onlineMode && submitting) && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100000, background: "rgba(15,23,42,0.88)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div className="bg-white text-center" style={{ borderRadius: 12, padding: 32, maxWidth: 460, width: "100%" }}>
            <i className="fa-solid fa-hourglass-end fa-3x text-danger mb-3"></i>
            <h4 className="fw-bold mb-2">Time is up!</h4>
            {onlineMode ? (
              <p className="text-muted mb-0">Your exam time has ended. This exam had to be submitted manually before the deadline, so it can no longer be submitted. Please contact the administrator.</p>
            ) : (
              <p className="text-muted mb-0">Your exam time has expired. Your exam is being submitted automatically. Please wait and do not close this window.</p>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2" style={{ background: "#0f172a", color: "#fff", padding: "10px 20px", flexShrink: 0 }}>
        <div className="d-flex align-items-center gap-3">
          <h5 className="mb-0 text-warning"><i className="fa-solid fa-graduation-cap me-2"></i>Online Exam Portal - Round 2</h5>
          <span className="badge bg-secondary">{candidateName || "Candidate Name"}</span>
        </div>
        <LiveClock style={{ backgroundColor: "rgba(255,255,255,0.1)", padding: "4px 12px", borderRadius: 6, fontSize: "0.85rem", color: "#38bdf8" }} className="d-none d-md-flex align-items-center" />
        {phase === "exam" && (
          <div className="d-flex align-items-center gap-3">
            <div className="bg-danger text-white px-3 py-1 rounded fw-bold">
              <i className="fa-regular fa-clock me-1"></i> Time Left: {minutes}:{seconds}
            </div>
          </div>
        )}
      </div>

      {phase === "start" && (
        <div className="flex-fill d-flex align-items-center justify-content-center" style={{ background: "#f4f6f9", overflowY: "auto" }}>
          <div className="bg-white text-center" style={{ borderRadius: 12, boxShadow: "0 8px 30px rgba(0,0,0,0.05)", padding: 40, maxWidth: 500, width: "100%" }}>
            <i className="fa-solid fa-pen-to-square fa-3x text-primary mb-3"></i>
            <h4 className="fw-bold mb-1">Round 2: Technical Assessment</h4>
            <p className="text-muted small mb-4">You have <span className="fw-bold">{mode ? durationMin : EXAM_DURATION_MIN}</span> minutes to answer the questions.</p>
            <div className="text-start bg-light p-3 rounded mb-4 border">
              <ul className="mb-0 small text-secondary">
                <li>Some questions have an <strong>answer box</strong>: type your answer exactly. Your answer is correct only if it matches the expected answer. Extra spaces and capital / small letters do not matter, but spelling and symbols must be exact.</li>
                <li>Other questions are <strong>MCQs</strong>: choose one option. They come in between the written questions.</li>
                <li>Copy, cut and paste are disabled. You can change an answer any time before you submit.</li>
                {onlineMode ? (
                  <li>You must click <strong>Complete Exam</strong> before the timer ends. This exam is <strong>not</strong> submitted automatically when the time is over and cannot be submitted after the deadline. The time is kept by the server, so refreshing the page does not restart it.</li>
                ) : (
                  <li>The exam will auto-submit when the timer expires{campus ? " (the time is kept by the server, so refreshing the page does not restart it)" : ""}.</li>
                )}
                <li>Your camera and microphone stay on during the exam. If background voice or movement in the camera is detected, a red warning appears under your camera box. Please sit alone in a quiet place.</li>
                <li>Do not leave fullscreen or switch tabs/windows — a second violation auto-submits your attempt.</li>
              </ul>
            </div>
            {mobileDevice ? (
              <div className="alert alert-danger text-start small">
                <strong>Mobile / tablet not allowed.</strong> This exam cannot be taken on a mobile phone or tablet. Please use a laptop or desktop computer with a webcam.
              </div>
            ) : camStatus !== "ok" ? (
              <div className="alert alert-warning text-start small">
                <div className="fw-bold">{(CAM_MESSAGES[camStatus] || CAM_MESSAGES.denied)[0]}</div>
                <div>{(CAM_MESSAGES[camStatus] || CAM_MESSAGES.denied)[1]}</div>
                {camStatus !== "checking" && (
                  <button type="button" className="btn btn-sm btn-primary mt-2" onClick={checkCamera}>
                    <i className="fa-solid fa-rotate me-1"></i>Check Camera Again
                  </button>
                )}
              </div>
            ) : (
              <div className="small text-success fw-bold mb-2"><i className="fa-solid fa-video me-1"></i>Camera connected</div>
            )}
            <button className="btn btn-primary w-100 fw-bold py-2" disabled={mobileDevice || camStatus !== "ok"} onClick={handleBegin}>
              Begin Assessment <i className="fa-solid fa-arrow-right ms-2"></i>
            </button>
          </div>
        </div>
      )}

      {phase === "exam" && q && (
        <div className="flex-fill" style={{ minHeight: 0, overflowY: "auto" }}>
          <div className="container-fluid py-3">
            <div className="row">
              {/* Left: Question area */}
              <div className="col-lg-9">
                <div className="shadow-sm" style={{ background: "#fff", border: "1px solid #cbd5e1", borderRadius: 6, minHeight: 480, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                  <div>
                    <div className="d-flex justify-content-between align-items-center" style={{ background: "#e2e8f0", padding: "10px 15px", fontWeight: "bold" }}>
                      <span>Question No. {currentIndex + 1} <span className="text-secondary fw-normal small">of {questions.length}</span></span>
                      <span className="d-flex align-items-center gap-2">
                        <span className="badge bg-secondary px-3 py-2">{q.type === "mcq" ? "MCQ" : "Written answer"}</span>
                        <span className="badge bg-primary px-3 py-2">Marks: +1, -0</span>
                      </span>
                    </div>

                    <div className="p-4">
                      {/* The question is plain text (never HTML), so tags such as <a> show as typed. */}
                      <h5 className="fw-semibold mb-3" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{q.description}</h5>

                      {q.type === "mcq" ? (
                        <div>
                          {(q.options || []).map((opt, i) => {
                            const chosen = String(answersRef.current[q.id]) === String(i);
                            return (
                              <label
                                key={i}
                                className="option-label"
                                style={{
                                  display: "block", background: locked ? "#f1f5f9" : "#f8fafc", border: "1px solid #cbd5e1",
                                  padding: "12px 15px", borderRadius: 6, cursor: locked ? "not-allowed" : "pointer", marginBottom: 10,
                                  opacity: locked ? 0.8 : 1
                                }}
                              >
                                <input
                                  type="radio"
                                  className="form-check-input me-3"
                                  name={`mcq-${q.id}`}
                                  checked={chosen}
                                  disabled={locked}
                                  onChange={() => setAnswer(q.id, String(i))}
                                />
                                <span className="option-text" style={chosen ? { fontWeight: "bold", color: "#0d6efd", whiteSpace: "pre-wrap" } : { whiteSpace: "pre-wrap" }}>
                                  {String.fromCharCode(65 + i)}. {opt}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <div>
                          <label className="form-label small fw-bold text-secondary text-uppercase">Your answer</label>
                          {clipMsg && (
                            <div className="text-danger fw-bold mb-1" style={{ fontSize: "0.78rem" }}>
                              <i className="fa-solid fa-ban me-1"></i>{clipMsg}
                            </div>
                          )}
                          <textarea
                            key={q.id}
                            rows={6}
                            spellCheck={false}
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="off"
                            placeholder="Type your answer here..."
                            value={answersRef.current[q.id] || ""}
                            readOnly={locked}
                            onChange={handleAnswerChange}
                            onKeyDown={handleAnswerKeyDown}
                            onCopy={blockClipboardEvent("copy")}
                            onCut={blockClipboardEvent("cut")}
                            onPaste={blockClipboardEvent("paste")}
                            onContextMenu={blockClipboardEvent("open the right-click menu")}
                            onDrop={blockClipboardEvent("drop text")}
                            onDragStart={(e) => e.preventDefault()}
                            className="form-control"
                            style={{ fontSize: "1rem", padding: 14, resize: "vertical", userSelect: "text", background: locked ? "#f1f5f9" : "#f8fafc", border: "1px solid #cbd5e1" }}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-light p-3 border-top d-flex justify-content-between align-items-center flex-wrap gap-2">
                    <div>
                      <button className="btn btn-outline-secondary me-2" disabled={locked || String(answersRef.current[q.id] || "") === ""} onClick={() => setAnswer(q.id, "")}>
                        <i className="fa-solid fa-rotate-left me-1"></i> Clear Response
                      </button>
                      <button className="btn btn-outline-secondary" disabled={currentIndex === 0} onClick={handlePrev}>
                        <i className="fa-solid fa-chevron-left me-1"></i> Prev
                      </button>
                    </div>
                    <div className="d-flex align-items-center">
                      {savedMsg && <span className="text-success fw-bold small me-3"><i className="fa-solid fa-circle-check me-1"></i>Answer saved</span>}
                      <button className="btn btn-success px-4 fw-bold me-2" disabled={locked} onClick={handleSave}>
                        <i className="fa-solid fa-floppy-disk me-1"></i> Save
                      </button>
                      <button className="btn btn-primary px-4 fw-bold" disabled={currentIndex === questions.length - 1} onClick={handleNext}>
                        Next <i className="fa-solid fa-chevron-right ms-1"></i>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right: Palette */}
              <div className="col-lg-3 mt-3 mt-lg-0">
                <div className="shadow-sm" style={{ background: "#fff", border: "1px solid #cbd5e1", borderRadius: 6, padding: 15 }}>
                  <h6 className="fw-bold mb-3 border-bottom pb-2"><i className="fa-solid fa-table-cells me-2"></i>Question Palette</h6>

                  <div className="row g-2 mb-3 small">
                    <div className="col-6"><span style={{ ...paletteBadge, background: "#198754" }}>{counts.answered}</span> Answered</div>
                    <div className="col-6"><span style={{ ...paletteBadge, background: "#dc3545" }}>{counts.notAnswered}</span> Not Answered</div>
                    <div className="col-6"><span style={{ ...paletteBadge, background: "#6c757d" }}>{counts.notVisited}</span> Not Visited</div>
                  </div>

                  <hr />

                  <div className="d-flex flex-wrap justify-content-start">
                    {questions.map((qq, idx) => {
                      const st = stateOf(qq, idx);
                      const bg = st === "answered" ? "#198754" : st === "not-answered" ? "#dc3545" : "#f1f5f9";
                      const color = st !== "not-visited" ? "#fff" : "#334155";
                      return (
                        <button
                          key={qq.id}
                          type="button"
                          onClick={() => loadQuestionInto(idx)}
                          style={{
                            width: 42, height: 42, margin: 4, fontWeight: "bold", borderRadius: 6,
                            border: idx === currentIndex ? "3px solid #0d6efd" : "1px solid #cbd5e1",
                            backgroundColor: bg, color, display: "flex", alignItems: "center", justifyContent: "center",
                            cursor: "pointer", padding: 0
                          }}
                        >
                          {idx + 1}
                        </button>
                      );
                    })}
                  </div>

                  <hr className="my-4" />

                  <button className="btn btn-danger w-100 py-2 fw-bold" disabled={locked} onClick={() => { if (window.confirm("Complete the exam? You cannot change your answers after this.")) submitExam(false); }}>
                    {submitting ? (
                      <><i className="fa-solid fa-spinner fa-spin me-2"></i>Submitting...</>
                    ) : (
                      <><i className="fa-solid fa-paper-plane me-2"></i>Complete Exam</>
                    )}
                  </button>
                </div>
                {/* keeps the palette clear of the fixed camera box in the bottom-right corner */}
                <div style={{ height: 170 }}></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {phase === "result" && (
        <div className="flex-fill d-flex align-items-center justify-content-center" style={{ background: "#f4f6f9", overflowY: "auto" }}>
          <div className="bg-white text-center" style={{ borderRadius: 12, boxShadow: "0 8px 30px rgba(0,0,0,0.05)", padding: 40, maxWidth: 500, width: "100%" }}>
            {resultKind === "expired" ? (
              <i className="fa-solid fa-hourglass-end fa-4x text-danger mb-3"></i>
            ) : (
              <i className="fa-solid fa-check-circle fa-4x text-success mb-3"></i>
            )}
            <h3 className="fw-bold mb-1">{resultKind === "expired" ? "Time Expired" : "Assessment Submitted"}</h3>
            <p className="text-muted mb-4">{resultLine}</p>
            <button className="btn btn-outline-dark fw-bold px-5" onClick={() => window.close()}>Close Window</button>
          </div>
        </div>
      )}
    </div>
  );
}

const paletteBadge = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 28, height: 28, borderRadius: "50%", fontSize: "0.75rem", color: "#fff", fontWeight: "bold"
};