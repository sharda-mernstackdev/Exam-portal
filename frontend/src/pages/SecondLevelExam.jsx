import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useExamGuard } from "../hooks/useExamGuard";
import { useProctor } from "../hooks/useProctor";
import FullscreenGate from "../components/FullscreenGate";
import LiveClock from "../components/LiveClock";
import ExamAPI from "../api";

const EXAM_DURATION_MIN = 45;

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

  function handleLockdownViolation() {
    if (phase !== "exam") return; // don't penalize leaving fullscreen before the exam actually starts
    violationCountRef.current++;
    if (violationCountRef.current >= 2) {
      alert("VIOLATION LIMIT EXCEEDED: Auto-submitting your Round 2 attempt!");
      submitExam(true);
    } else {
      alert(`WARNING (${violationCountRef.current}/2): Leaving fullscreen or switching windows is forbidden!`);
    }
  }

  const { fullscreen, enter } = useExamGuard(true, handleLockdownViolation);

  const [candidateName, setCandidateName] = useState("");
  const [questions, setQuestions] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentLang, setCurrentLang] = useState("javascript");
  const [code, setCode] = useState("");
  const [timeLeft, setTimeLeft] = useState(EXAM_DURATION_MIN * 60);
  const [resultLine, setResultLine] = useState("");
  const [resultScore, setResultScore] = useState({ passed: 0, total: 0 });
  const [submitting, setSubmitting] = useState(false);

  const userCodeRef = useRef({}); // userCode[q.id][lang]
  const questionStatusRef = useRef({}); // q.id -> status
  const lastRunRef = useRef({}); // q.id -> evalResult
  const [, forceRender] = useState(0);
  const rerender = () => forceRender((n) => n + 1);

  useProctor(phase === "exam");

  // Anti-tab-switching monitor — shares the violation counter with leaving
  // fullscreen (handleLockdownViolation above).
  useEffect(() => {
    if (phase !== "exam") return undefined;
    function onVisibility() {
      if (document.hidden && localStorage.getItem("examStatus") === "locked") {
        handleLockdownViolation();
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
      .then((qs) => {
        if (!qs) return;
        if (!qs.length) {
          alert("No Round 2 questions are available right now. Please contact the administrator.");
          navigate("/login", { replace: true });
          return;
        }
        qs.forEach((q) => {
          userCodeRef.current[q.id] = {
            javascript: q.starterCode.javascript,
            python: q.starterCode.python,
            cpp: q.starterCode.cpp
          };
          questionStatusRef.current[q.id] = "not-attempted";
        });
        setQuestions(qs);
        setCode(qs[0].starterCode.javascript);
        setPhase("start");
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

  function saveCode(nextCode = code) {
    if (!questions) return;
    userCodeRef.current[questions[currentIndex].id][currentLang] = nextCode;
  }

  function loadQuestionInto(idx, lang) {
    setCurrentIndex(idx);
    setCode(userCodeRef.current[questions[idx].id][lang]);
  }

  function handleBegin() {
    setPhase("exam");
  }

  // Timer
  useEffect(() => {
    if (phase !== "exam") return undefined;
    if (timeLeft <= 0) {
      submitExam(true);
      return undefined;
    }
    const id = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, timeLeft]);

  function handleLangChange(lang) {
    saveCode();
    setCurrentLang(lang);
    setCode(userCodeRef.current[questions[currentIndex].id][lang]);
  }

  function handleRun() {
    saveCode();
    const q = questions[currentIndex];
    const evalResult = evaluateQuestion(q, userCodeRef.current[q.id][currentLang], currentLang);
    lastRunRef.current[q.id] = evalResult;
    questionStatusRef.current[q.id] = evalResult.passed === evalResult.total ? "solved" : "attempted";
    rerender();
  }

  function handleReset() {
    const q = questions[currentIndex];
    if (!window.confirm("Reset code to starter template for this language?")) return;
    userCodeRef.current[q.id][currentLang] = q.starterCode[currentLang];
    setCode(q.starterCode[currentLang]);
    lastRunRef.current[q.id] = null;
    rerender();
  }

  function handleNext() {
    saveCode();
    if (currentIndex < questions.length - 1) loadQuestionInto(currentIndex + 1, currentLang);
  }
  function handlePrev() {
    saveCode();
    if (currentIndex > 0) loadQuestionInto(currentIndex - 1, currentLang);
  }

  function handleEditorKeyDown(e) {
    if (e.key === "Tab") {
      e.preventDefault();
      const el = e.target;
      const s = el.selectionStart, end = el.selectionEnd;
      const next = code.substring(0, s) + "    " + code.substring(end);
      setCode(next);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 4; });
    }
  }

  function submitExam(auto) {
    saveCode();
    setSubmitting(true);
    let totalPassed = 0, totalCases = 0;
    const answers = questions.map((q) => {
      const res = evaluateQuestion(q, userCodeRef.current[q.id][currentLang], currentLang);
      totalPassed += res.passed;
      totalCases += res.total;
      return { title: q.title, code: userCodeRef.current[q.id][currentLang], language: currentLang, passed: res.passed, total: res.total };
    });

    ExamAPI.submitSecondLevel({ answers, totalScore: totalPassed })
      .then(() => {
        setResultLine(auto ? "Auto-submitted due to time limits." : "Your code has been uploaded to the admin dashboard.");
        setResultScore({ passed: totalPassed, total: totalCases });
        setPhase("result");
      })
      .catch((err) => {
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
            <button className="btn btn-outline-light btn-sm fw-bold" disabled={submitting} onClick={() => { if (window.confirm("Submit assessment? You cannot modify code after submission.")) submitExam(false); }}>
              Submit Code
            </button>
          </div>
        )}
      </div>

      {phase === "start" && (
        <div className="flex-fill d-flex align-items-center justify-content-center" style={{ background: "#f4f6f9", overflowY: "auto" }}>
          <div className="bg-white text-center" style={{ borderRadius: 12, boxShadow: "0 8px 30px rgba(0,0,0,0.05)", padding: 40, maxWidth: 500, width: "100%" }}>
            <i className="fa-solid fa-code fa-3x text-primary mb-3"></i>
            <h4 className="fw-bold mb-1">Round 2: Technical & Coding</h4>
            <p className="text-muted small mb-4">You have <span className="fw-bold">{EXAM_DURATION_MIN}</span> minutes to solve algorithmic problems.</p>
            <div className="text-start bg-light p-3 rounded mb-4 border">
              <ul className="mb-0 small text-secondary">
                <li>Select your preferred programming language (JavaScript, Python, C++) from the code editor dropdown.</li>
                <li>Use <strong>Run Code</strong> to execute your solution against visible and hidden test cases.</li>
                <li>Your code must return the specified output format exactly.</li>
                <li>The exam will auto-submit when the timer expires.</li>
              </ul>
            </div>
            <button className="btn btn-primary w-100 fw-bold py-2" onClick={handleBegin}>
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
                  onClick={() => { saveCode(); loadQuestionInto(idx, currentLang); }}
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
                    <button className="btn btn-sm btn-outline-secondary fw-bold me-2" onClick={handleReset}>
                      <i className="fa-solid fa-rotate-left me-1"></i> Reset
                    </button>
                    <button className="btn btn-sm btn-success fw-bold" onClick={handleRun}>
                      <i className="fa-solid fa-play me-1"></i> Run Code
                    </button>
                  </div>
                </div>

                <textarea
                  spellCheck={false}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={handleEditorKeyDown}
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

                <div className="d-flex justify-content-between" style={{ gap: 10 }}>
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
            <div className="bg-light p-4 rounded border mb-4">
              <h1 className="display-4 fw-bold text-primary mb-0">
                {resultScore.passed}<span className="fs-4 text-secondary"> / {resultScore.total}</span>
              </h1>
              <p className="small text-muted fw-bold text-uppercase mt-2 mb-0">Total Test Cases Passed</p>
            </div>
            <button className="btn btn-outline-dark fw-bold px-5" onClick={() => window.close()}>Close Window</button>
          </div>
        </div>
      )}
    </div>
  );
}
