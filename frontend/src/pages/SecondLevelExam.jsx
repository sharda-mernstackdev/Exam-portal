import { useEffect, useMemo, useRef, useState } from "react";
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
  checking: ["Checking your camera...", "Please click Allow when the browser asks for camera permission."],
  denied: ["Camera permission is blocked", "Allow camera access for this site in the browser (lock icon in the address bar), then click Check Camera Again."],
  nocamera: ["No camera found", "Connect a webcam to this computer, then click Check Camera Again."],
  busy: ["Camera is in use by another app", "Close other apps or tabs using the camera, then click Check Camera Again."],
  unsupported: ["Camera is not supported", "Please use the latest Chrome or Edge on a laptop or desktop."],
  lost: ["Camera was disconnected", "Reconnect your camera, then click Check Camera Again."]
};

// ---- Per-question code drafts (survive a refresh / re-login on this browser) ----
// Every draft is stored under: round 2 + candidate (id from the signed-in
// token) + the question's own id + the language. Nothing is keyed by the
// question's position, so one question's code can never land in another's.
function getDraftOwner() {
  try {
    const t = localStorage.getItem("studentToken") || "";
    const payload = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return String(payload.id || payload.email || "");
  } catch (e) {
    return String(localStorage.getItem("candidateEmail") || "");
  }
}
function draftCodeKey(owner, qid, lang) { return `r2code:${owner}:${qid}:${lang}`; }
function draftLangKey(owner, qid) { return `r2lang:${owner}:${qid}`; }
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
      if (k && (k.indexOf(`r2code:${owner}:`) === 0 || k.indexOf(`r2lang:${owner}:`) === 0)) drop.push(k);
    }
    drop.forEach((k) => localStorage.removeItem(k));
  } catch (e) { /* ignore */ }
}

function runTestCase(code, funcName, args) {
  try {
    const body = '"use strict";\n' + code + "\nreturn " + funcName + "(...args);";
    // eslint-disable-next-line no-new-func
    const runner = new Function("args", body);
    return { ok: true, result: runner(args) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function evaluateQuestion(question, code, lang) {
  if (lang === "javascript") {
    const results = question.testCases.map((tc) => {
      const run = runTestCase(code, question.funcName, tc.input);
      let pass = false;
      try {
        pass = run.ok && JSON.stringify(run.result) === JSON.stringify(tc.expected);
      } catch (e) {
        pass = run.result === tc.expected;
      }
      return { pass, hidden: tc.hidden, input: tc.input, expected: tc.expected, actual: run.ok ? run.result : undefined, error: run.ok ? null : run.error };
    });
    return { results, passed: results.filter((r) => r.pass).length, total: results.length };
  }
  const defaultCode = question.starterCode[lang].trim();
  const hasModified = code.trim() !== defaultCode && code.trim().length > defaultCode.length - 10;
  const results = question.testCases.map((tc) => ({
    pass: hasModified,
    hidden: tc.hidden,
    input: tc.input,
    expected: tc.expected,
    actual: hasModified ? tc.expected : undefined,
    error: hasModified ? null : "Simulated Compiler Error: Method implementation missing."
  }));
  return { results, passed: hasModified ? results.length : 0, total: results.length };
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
  const lockdownHandlerRef = useRef(null);

  function handleLockdownViolation(kind) {
    if (phaseRef.current !== "exam") return; // don't penalize before the exam starts
    if (submittedRef.current) return;
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
  const [currentLang, setCurrentLang] = useState("javascript");
  const [code, setCode] = useState("");
  const [timeLeft, setTimeLeft] = useState(EXAM_DURATION_MIN * 60);
  // Campus Mode: the SERVER fixes the deadline (when Begin is pressed) and keeps
  // the latest auto-saved code; this page only counts down to that deadline.
  // Online mode keeps the original local timer.
  const [campus, setCampus] = useState(false);
  const [durationMin, setDurationMin] = useState(EXAM_DURATION_MIN);
  const deadlineRef = useRef(null);   // server deadline (ms, server clock)
  const offsetRef = useRef(0);        // server clock minus this computer's clock
  const beginBusyRef = useRef(false);
  const draftBusyRef = useRef(false);
  const lastSavedRef = useRef("");
  const [resultLine, setResultLine] = useState("");
  const [resultScore, setResultScore] = useState({ passed: 0, total: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [clipMsg, setClipMsg] = useState("");
  const clipMsgTimerRef = useRef(null);
  const lastClipLogRef = useRef(0);

  // Source of truth for the candidate's code: userCodeRef.current[questionId][language].
  // It is written on every keystroke (see setQuestionCode), so there is never a
  // "pending save" that a later navigation or a stale closure could apply to the
  // wrong question. langByQRef remembers which language each question is in.
  const userCodeRef = useRef({}); // userCode[q.id][lang]
  const langByQRef = useRef({}); // q.id -> language
  const draftOwnerRef = useRef("");
  const questionStatusRef = useRef({}); // q.id -> status
  const lastRunRef = useRef({}); // q.id -> evalResult
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
    navigator.mediaDevices
      .getUserMedia({ video: { width: 320, height: 240, facingMode: "user" }, audio: false })
      .then((s) => {
        camStreamRef.current = s;
        s.getVideoTracks().forEach((t) => t.addEventListener("ended", () => setCamStatus("lost")));
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
          const starter = q.starterCode || {};
          const codes = {};
          ["javascript", "python", "cpp"].forEach((lang) => {
            const draft = readDraft(draftCodeKey(owner, q.id, lang));
            codes[lang] = draft !== null ? draft : (starter[lang] || "");
          });
          userCodeRef.current[q.id] = codes; // a fresh object per question
          const savedLang = readDraft(draftLangKey(owner, q.id));
          langByQRef.current[q.id] = ["javascript", "python", "cpp"].includes(savedLang) ? savedLang : "javascript";
          questionStatusRef.current[q.id] = "not-attempted";
        });
        questionsRef.current = qs;
        setQuestions(qs);
        setCurrentIndex(0);
        setCurrentLang(langByQRef.current[qs[0].id]);
        setCode(userCodeRef.current[qs[0].id][langByQRef.current[qs[0].id]]);
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

  // Writes `value` as the code of ONE question in ONE language (memory + draft).
  function setQuestionCode(qid, lang, value) {
    if (!userCodeRef.current[qid]) return;
    userCodeRef.current[qid][lang] = value;
    writeDraft(draftCodeKey(draftOwnerRef.current, qid, lang), value);
  }

  function setQuestionLang(qid, lang) {
    langByQRef.current[qid] = lang;
    writeDraft(draftLangKey(draftOwnerRef.current, qid), lang);
  }

  // Shows question `idx`: its own language and its own code (or starter).
  function loadQuestionInto(idx) {
    const target = questions[idx];
    if (!target) return;
    const lang = langByQRef.current[target.id] || "javascript";
    setCurrentIndex(idx);
    setCurrentLang(lang);
    setCode(userCodeRef.current[target.id][lang]);
  }

  // Reads the server's timer information (see GET /second-level/status).
  function applyTiming(t) {
    if (!t) return;
    setCampus(!!t.campus);
    if (!t.campus) return;
    setDurationMin(Number(t.durationMinutes) || EXAM_DURATION_MIN);
    if (t.started && t.deadlineAt) {
      offsetRef.current = Date.parse(t.serverTime) - Date.now();
      deadlineRef.current = Date.parse(t.deadlineAt);
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
        setPhase("exam");
      })
      .catch((err) => {
        if (err.status === 401 || err.status === 409) {
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
    setSubmitting(false);
    setPhase("result");
  }

  // Timer - Online mode: the original local countdown.
  useEffect(() => {
    if (phase !== "exam" || campus || timeLeft <= 0) return undefined;
    const id = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(id);
  }, [phase, timeLeft, campus]);

  // Timer - Campus mode: counts down to the SERVER's deadline, using the
  // server's clock, so refreshing the page or changing this computer's clock
  // does not change the time left.
  useEffect(() => {
    if (phase !== "exam" || !campus) return undefined;
    function tick() {
      if (!deadlineRef.current) return;
      const rem = Math.max(0, Math.ceil((deadlineRef.current - (Date.now() + offsetRef.current)) / 1000));
      setTimeLeft(rem);
    }
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [phase, campus]);

  // Time is up -> submit automatically. submitExam can only run once (see
  // submittedRef), however many times this effect fires.
  useEffect(() => {
    if (phase === "exam" && timeLeft <= 0) submitExam(true, "time");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, timeLeft]);

  // Campus mode: every 10 s send the server the current code of every
  // question (each with its own language). If the browser dies before the
  // deadline, the server finalizes the exam from the latest copy it received.
  useEffect(() => {
    if (phase !== "exam" || !campus) return undefined;
    function save() {
      if (submittedRef.current || draftBusyRef.current || !questionsRef.current) return;
      const answers = questionsRef.current.map((qq) => {
        const lang = langByQRef.current[qq.id] || "javascript";
        const last = lastRunRef.current[qq.id];
        return {
          questionId: qq.id,
          language: lang,
          code: (userCodeRef.current[qq.id] && userCodeRef.current[qq.id][lang]) || "",
          passed: last ? last.passed : 0
        };
      });
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

  function handleLangChange(lang) {
    const cur = questions[currentIndex];
    setQuestionLang(cur.id, lang);
    setCurrentLang(lang);
    setCode(userCodeRef.current[cur.id][lang]);
  }

  // Once time is up (or the exam is being submitted) nothing can be changed.
  const locked = submitting || (phase === "exam" && timeLeft <= 0);

  function handleRun() {
    if (locked) return;
    const q = questions[currentIndex];
    const evalResult = evaluateQuestion(q, userCodeRef.current[q.id][currentLang], currentLang);
    lastRunRef.current[q.id] = evalResult;
    questionStatusRef.current[q.id] = evalResult.passed === evalResult.total ? "solved" : "attempted";
    rerender();
  }

  function handleReset() {
    if (locked) return;
    const q = questions[currentIndex];
    if (!window.confirm("Reset code to starter template for this language?")) return;
    const starter = (q.starterCode && q.starterCode[currentLang]) || "";
    setQuestionCode(q.id, currentLang, starter);
    setCode(starter);
    lastRunRef.current[q.id] = null;
    rerender();
  }

  function handleNext() {
    if (currentIndex < questions.length - 1) loadQuestionInto(currentIndex + 1);
  }
  function handlePrev() {
    if (currentIndex > 0) loadQuestionInto(currentIndex - 1);
  }

  // ---- No copy / cut / paste in the code editor ----
  // The code must be typed by the candidate. This blocks the ordinary
  // clipboard routes inside the editor itself (keyboard shortcuts, the
  // right-click menu, the browser menu, drag-and-drop of text, and a paste that
  // arrives as an input event). Typing, Tab indent, selecting, Ctrl/Cmd+A,
  // undo/redo, Run and Submit are untouched. A browser cannot stop every
  // possible way of getting text in (e.g. a typing-automation tool or
  // another device), so the server-side checks and the proctoring log stay
  // in place; each blocked attempt is also recorded in the proctor log.
  function clipboardBlocked(what) {
    setClipMsg("Copy, cut and paste are disabled in the code editor. Please type your code.");
    clearTimeout(clipMsgTimerRef.current);
    clipMsgTimerRef.current = setTimeout(() => setClipMsg(""), 3000);
    const now = Date.now();
    if (now - lastClipLogRef.current > 8000) {
      lastClipLogRef.current = now;
      try {
        ExamAPI.logProctorEvent({ type: "clipboard_blocked", detail: "Tried to " + what + " in the code editor", page: location.pathname }).catch(() => {});
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

  function handleEditorChange(e) {
    if (locked) return;
    // A paste / drop / cut that slipped past the handlers above shows up here
    // as an input event of that type: ignore it (the controlled textarea
    // then keeps its previous text).
    const t = e.nativeEvent && e.nativeEvent.inputType;
    if (t === "insertFromPaste" || t === "insertFromPasteAsQuotation" || t === "insertFromDrop" || t === "insertFromYank" || t === "deleteByCut") {
      clipboardBlocked(t === "deleteByCut" ? "cut" : "paste");
      return;
    }
    setCode(e.target.value);
    setQuestionCode(questions[currentIndex].id, currentLang, e.target.value);
  }

  function handleEditorKeyDown(e) {
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
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.target;
      const s = el.selectionStart, end = el.selectionEnd;
      const next = code.substring(0, s) + "    " + code.substring(end);
      setCode(next);
      setQuestionCode(questions[currentIndex].id, currentLang, next);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 4; });
    }
  }

  function submitExam(auto, reason) {
    const qs = questionsRef.current || questions;
    if (!qs || submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    let totalPassed = 0, totalCases = 0;
    // Each question is evaluated and sent with ITS OWN code and ITS OWN
    // language (not whatever language happens to be selected on screen).
    // Everything is read from the per-question store, so this is correct even
    // when called from an older render (timer / violation handlers).
    const answers = qs.map((q) => {
      const lang = langByQRef.current[q.id] || "javascript";
      const qCode = (userCodeRef.current[q.id] && userCodeRef.current[q.id][lang]) || "";
      const res = evaluateQuestion(q, qCode, lang);
      totalPassed += res.passed;
      totalCases += res.total;
      return { questionId: q.id, title: q.title, code: qCode, language: lang, passed: res.passed, total: res.total };
    });

    ExamAPI.submitSecondLevel({ answers, totalScore: totalPassed, auto: !!auto, reason: reason || "" })
      .then(() => {
        clearDrafts(draftOwnerRef.current);
        setResultLine(
          reason === "time"
            ? "Time is up! Your exam time has expired and your exam was submitted automatically."
            : auto
              ? "Your exam was submitted automatically because of rule violations."
              : "Your code has been uploaded to the admin dashboard."
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
        if (err.status === 401) {
          setSubmitting(false);
          alert(err.message || "Your session has ended. Please log in again.");
          return;
        }
        // Network problem. When the time is up the exam must still be handed
        // in, so keep retrying every 3 s (the server also closes the exam
        // itself shortly after the deadline, from the code it already has).
        if (reason === "time") {
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
  const evalResult = q ? lastRunRef.current[q.id] : null;
  const minutes = String(Math.floor(timeLeft / 60)).padStart(2, "0");
  const seconds = String(timeLeft % 60).padStart(2, "0");

  return (
    <div style={{ background: "#f4f6f9", fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", userSelect: "none", height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {phase === "exam" && timeLeft <= 0 && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100000, background: "rgba(15,23,42,0.88)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div className="bg-white text-center" style={{ borderRadius: 12, padding: 32, maxWidth: 460, width: "100%" }}>
            <i className="fa-solid fa-hourglass-end fa-3x text-danger mb-3"></i>
            <h4 className="fw-bold mb-2">Time is up!</h4>
            <p className="text-muted mb-0">Your exam time has expired. Your exam is being submitted automatically. Please wait and do not close this window.</p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="d-flex justify-content-between align-items-center" style={{ background: "#0f172a", color: "#fff", padding: "12px 24px", flexShrink: 0 }}>
        <div className="d-flex align-items-center gap-3">
          <h5 className="mb-0 text-warning"><i className="fa-solid fa-laptop-code me-2"></i>Test Cases Exam</h5>
          <span className="badge bg-secondary px-3 py-2">{candidateName || "Candidate Name"}</span>
        </div>
        <LiveClock style={{ backgroundColor: "rgba(255,255,255,0.1)", padding: "4px 12px", borderRadius: 6, fontSize: "0.85rem", color: "#38bdf8" }} className="d-none d-md-flex align-items-center" />
        {phase === "exam" && (
          <div className="d-flex align-items-center gap-3">
            <div className="bg-danger text-white px-3 py-1 rounded fw-bold">
              <i className="fa-regular fa-clock me-1"></i> {minutes}:{seconds}
            </div>
            <button className="btn btn-outline-light btn-sm fw-bold" disabled={locked} onClick={() => { if (window.confirm("Complete the exam? You cannot modify your code after this.")) submitExam(false); }}>
              Complete Exam
            </button>
          </div>
        )}
      </div>

      {phase === "start" && (
        <div className="flex-fill d-flex align-items-center justify-content-center" style={{ background: "#f4f6f9", overflowY: "auto" }}>
          <div className="bg-white text-center" style={{ borderRadius: 12, boxShadow: "0 8px 30px rgba(0,0,0,0.05)", padding: 40, maxWidth: 500, width: "100%" }}>
            <i className="fa-solid fa-code fa-3x text-primary mb-3"></i>
            <h4 className="fw-bold mb-1">Round 2: Technical & Coding</h4>
            <p className="text-muted small mb-4">You have <span className="fw-bold">{campus ? durationMin : EXAM_DURATION_MIN}</span> minutes to solve algorithmic problems.</p>
            <div className="text-start bg-light p-3 rounded mb-4 border">
              <ul className="mb-0 small text-secondary">
                <li>Select your preferred programming language (JavaScript, Python, C++) from the code editor dropdown.</li>
                <li>Use <strong>Run Code</strong> to execute your solution against visible and hidden test cases.</li>
                <li>Your code must return the specified output format exactly.</li>
                <li>The exam will auto-submit when the timer expires{campus ? " (the time is kept by the server, so refreshing the page does not restart it)" : ""}.</li>
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
        <div className="flex-fill d-flex" style={{ minHeight: 0 }}>
          <div className="d-flex w-100 h-100" style={{ gap: 16, padding: 16 }}>
            {/* Sidebar */}
            <div style={{ width: 250, flexShrink: 0, background: "#fff", borderRadius: 8, border: "1px solid #cbd5e1", padding: 16, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="fw-bold text-uppercase" style={{ fontSize: "0.85rem", color: "#64748b", marginBottom: 8 }}>
                <i className="fa-solid fa-list-check me-2"></i>Problems
              </div>
              {questions.map((qq, idx) => (
                <div
                  key={qq.id}
                  onClick={() => loadQuestionInto(idx)}
                  className="d-flex align-items-center justify-content-between"
                  style={{
                    background: idx === currentIndex ? "#0d6efd" : "#f8fafc",
                    color: idx === currentIndex ? "#fff" : "#334155",
                    border: `1px solid ${idx === currentIndex ? "#0d6efd" : "#cbd5e1"}`,
                    borderRadius: 6, padding: "10px 12px", fontWeight: 600, fontSize: "0.85rem", cursor: "pointer"
                  }}
                >
                  <span>Q{idx + 1}. {qq.title}</span>
                  <span style={{
                    width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                    background: questionStatusRef.current[qq.id] === "solved" ? "#10b981" : questionStatusRef.current[qq.id] === "attempted" ? "#f59e0b" : "#cbd5e1"
                  }}></span>
                </div>
              ))}
            </div>

            {/* Main */}
            <div className="d-flex flex-fill" style={{ gap: 16, minWidth: 0 }}>
              {/* Problem pane */}
              <div style={{ flex: 1, background: "#fff", borderRadius: 8, border: "1px solid #cbd5e1", padding: 20, overflowY: "auto", borderRight: "2px dashed #e2e8f0" }}>
                <div className="d-flex align-items-center mb-3">
                  <span className="fw-bold" style={{ color: "#1e293b", fontSize: "1.25rem" }}>Q{currentIndex + 1}. {q.title}</span>
                  <span
                    className="ms-2"
                    style={{
                      fontSize: "0.75rem", fontWeight: 700, padding: "4px 10px", borderRadius: 20,
                      background: q.difficulty === "Easy" ? "#d1fae5" : q.difficulty === "Medium" ? "#fef3c7" : "#ffe4e6",
                      color: q.difficulty === "Easy" ? "#059669" : q.difficulty === "Medium" ? "#d97706" : "#e11d48"
                    }}
                  >
                    {q.difficulty}
                  </span>
                </div>
                <div style={{ fontSize: "0.95rem", color: "#334155", margin: "16px 0", lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: q.description }} />
                <h6 className="fw-bold text-secondary fs-6 mt-2 mb-3 border-bottom pb-2">Examples</h6>
                {q.examples.map((ex, i) => (
                  <div key={i} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: 12, marginBottom: 12, fontSize: "0.85rem", fontFamily: "Consolas, monospace" }}>
                    <strong>Example {i + 1}:</strong><br />Input: <code>{ex.input}</code><br />Output: <code>{ex.output}</code>
                  </div>
                ))}
              </div>

              {/* Editor pane */}
              <div style={{ flex: 1.5, display: "flex", flexDirection: "column", background: "#fff", borderRadius: 8, border: "1px solid #cbd5e1", padding: 20 }}>
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <select
                    className="form-select form-select-sm fw-bold bg-light border-secondary text-primary"
                    style={{ width: 140, display: "inline-block" }}
                    value={currentLang}
                    onChange={(e) => handleLangChange(e.target.value)}
                  >
                    <option value="javascript">JavaScript (ES6)</option>
                    <option value="python">Python 3.10</option>
                    <option value="cpp">C++ 17</option>
                  </select>
                  <div>
                    <button className="btn btn-sm btn-outline-secondary fw-bold me-2" disabled={locked} onClick={handleReset}>
                      <i className="fa-solid fa-rotate-left me-1"></i> Reset
                    </button>
                    <button className="btn btn-sm btn-success fw-bold" disabled={locked} onClick={handleRun}>
                      <i className="fa-solid fa-play me-1"></i> Run Code
                    </button>
                  </div>
                </div>

                {clipMsg && (
                  <div className="text-danger fw-bold mb-1" style={{ fontSize: "0.78rem" }}>
                    <i className="fa-solid fa-ban me-1"></i>{clipMsg}
                  </div>
                )}
                <textarea
                  key={`${q.id}:${currentLang}`}
                  spellCheck={false}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  value={code}
                  readOnly={locked}
                  onChange={handleEditorChange}
                  onKeyDown={handleEditorKeyDown}
                  onCopy={blockClipboardEvent("copy")}
                  onCut={blockClipboardEvent("cut")}
                  onPaste={blockClipboardEvent("paste")}
                  onContextMenu={blockClipboardEvent("open the right-click menu")}
                  onDrop={blockClipboardEvent("drop text")}
                  onDragStart={(e) => e.preventDefault()}
                  style={{
                    flex: 1, width: "100%", background: "#1e1e2e", color: "#e6e6f0", fontFamily: "Consolas, monospace",
                    fontSize: "0.9rem", borderRadius: 8, border: "none", padding: 16, resize: "none", tabSize: 4, marginBottom: 12, outline: "none"
                  }}
                />

                <div style={{ background: "#12121c", borderRadius: 8, padding: 16, minHeight: 120, maxHeight: 200, overflowY: "auto", fontFamily: "Consolas, monospace", fontSize: "0.85rem", color: "#d8d8e6", marginBottom: 16 }}>
                  {currentLang !== "javascript" && (
                    <div className="alert alert-dark text-warning p-2 mb-2" style={{ fontSize: "0.75rem" }}>
                      <i className="fa-solid fa-info-circle me-1"></i> Note: Python and C++ compilation is simulated in this UI demo.
                    </div>
                  )}
                  {!evalResult ? (
                    currentLang === "javascript" && <div className="text-muted"><i className="fa-solid fa-terminal me-2"></i>Console output will appear here after you run your code.</div>
                  ) : (
                    <>
                      <div style={{ fontWeight: 700, color: "#fff", marginBottom: 8, fontSize: "0.9rem", borderBottom: "1px solid #333", paddingBottom: 8 }}>
                        {evalResult.passed} / {evalResult.total} Test Cases Passed
                      </div>
                      {evalResult.results.map((r, i) => (
                        <div key={i}>
                          <div className="d-flex align-items-center" style={{ padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                            <span className="me-2" style={{ fontSize: "0.72rem", fontWeight: 700, padding: "3px 10px", borderRadius: 12, background: r.pass ? "#064e3b" : "#7f1d1d", color: r.pass ? "#34d399" : "#f87171" }}>
                              {r.pass ? "PASS" : "FAIL"}
                            </span>
                            {r.hidden ? (
                              <span className="text-muted small flex-grow-1">Hidden Test Case</span>
                            ) : (
                              <span className="small flex-grow-1" style={{ color: "#e2e8f0", fontFamily: "monospace" }}>
                                Input: {JSON.stringify(r.input)} | Expected: {JSON.stringify(r.expected)}
                              </span>
                            )}
                          </div>
                          {r.error && <div className="small ms-5" style={{ color: "#f87171", marginTop: 4 }}>{r.error}</div>}
                        </div>
                      ))}
                    </>
                  )}
                </div>

                {/* Prev / Next row. The camera box is fixed in the bottom-right corner (about
                    184px wide), so the right padding keeps Next to the LEFT of it instead of
                    underneath it. Pixel values scale with browser zoom exactly like the camera
                    box does; flexWrap keeps both buttons visible on a narrow window. */}
                <div className="d-flex justify-content-between" style={{ gap: 10, paddingRight: 160, flexWrap: "wrap" }}>
                  <button className="btn btn-outline-secondary fw-bold px-4" disabled={currentIndex === 0} onClick={handlePrev}>
                    <i className="fa-solid fa-arrow-left me-2"></i> Prev
                  </button>
                  <button className="btn btn-primary fw-bold px-4" onClick={handleNext}>
                    {currentIndex === questions.length - 1 ? (<><i className="fa-solid fa-save me-1"></i> Save</>) : (<>Next <i className="fa-solid fa-arrow-right ms-2"></i></>)}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {phase === "result" && (
        <div className="flex-fill d-flex align-items-center justify-content-center" style={{ background: "#f4f6f9", overflowY: "auto" }}>
          <div className="bg-white text-center" style={{ borderRadius: 12, boxShadow: "0 8px 30px rgba(0,0,0,0.05)", padding: 40, maxWidth: 500, width: "100%" }}>
            <i className="fa-solid fa-check-circle fa-4x text-success mb-3"></i>
            <h3 className="fw-bold mb-1">Assessment Submitted</h3>
            <p className="text-muted mb-4">{resultLine}</p>
            {resultScore && (
              <div className="bg-light p-4 rounded border mb-4">
                <h1 className="display-4 fw-bold text-primary mb-0">
                  {resultScore.passed}<span className="fs-4 text-secondary"> / {resultScore.total}</span>
                </h1>
                <p className="small text-muted fw-bold text-uppercase mt-2 mb-0">Total Test Cases Passed</p>
              </div>
            )}
            <button className="btn btn-outline-dark fw-bold px-5" onClick={() => window.close()}>Close Window</button>
          </div>
        </div>
      )}
    </div>
  );
}