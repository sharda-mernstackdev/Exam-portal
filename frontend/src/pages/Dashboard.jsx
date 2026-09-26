import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useExamGuard } from "../hooks/useExamGuard";
import { useProctor } from "../hooks/useProctor";
import { useSessionGuard } from "../hooks/useSessionGuard";
import FullscreenGate from "../components/FullscreenGate";
import LiveClock from "../components/LiveClock";
import ExamAPI from "../api";

const CALC_BUTTONS = [
  ["C", "(", ")", "/"],
  ["7", "8", "9", "*"],
  ["4", "5", "6", "-"],
  ["1", "2", "3", "+"],
  ["0", ".", "="]
];

export default function Dashboard() {
  const navigate = useNavigate();
  const { ready, candidateName } = useSessionGuard();
  const tabSwitchCountRef = useRef(0);
  const submitRef = useRef(() => {});

  function handleLockdownViolation() {
    tabSwitchCountRef.current++;
    if (tabSwitchCountRef.current >= 2) {
      alert("VIOLATION LIMIT EXCEEDED: Auto-submitting exam!");
      submitRef.current();
    } else {
      alert(`WARNING (${tabSwitchCountRef.current}/2): Leaving fullscreen or switching windows is forbidden!`);
    }
  }

  const { fullscreen, enter } = useExamGuard(ready, handleLockdownViolation);
  useProctor(ready);

  const [questions, setQuestions] = useState(null); // null = loading
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeCategory, setActiveCategory] = useState("");
  const [userAnswers, setUserAnswers] = useState({});
  const [questionStates, setQuestionStates] = useState({});
  const [lockedQuestions, setLockedQuestions] = useState({});
  const [timeLeft, setTimeLeft] = useState(30 * 60);
  const [submitting, setSubmitting] = useState(false);
  const [calcDisplay, setCalcDisplay] = useState("0");

  // Load the live question bank once the session is verified.
  useEffect(() => {
    if (!ready) return;
    ExamAPI.getQuestions()
      .then((qs) => {
        if (!qs || qs.length === 0) {
          alert("No exam questions are available right now. Please contact the administrator.");
          navigate("/login", { replace: true });
          return;
        }
        setQuestions(qs);
        setActiveCategory(qs[0].category);
        const states = {};
        qs.forEach((_, idx) => { states[idx] = "not-visited"; });
        states[0] = "not-answered";
        setQuestionStates(states);
      })
      .catch((err) => {
        localStorage.removeItem("examStatus");
        localStorage.removeItem("studentToken");
        alert(err.message || "Your session has expired. Please log in again.");
        navigate("/login", { replace: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const categories = useMemo(() => {
    if (!questions) return [];
    const seen = [];
    questions.forEach((q) => { if (!seen.includes(q.category)) seen.push(q.category); });
    return seen.map((cat) => {
      let first = -1, last = -1;
      questions.forEach((q, idx) => {
        if (q.category === cat) {
          if (first === -1) first = idx + 1;
          last = idx + 1;
        }
      });
      return { cat, range: first === last ? `(${first})` : `(${first}-${last})` };
    });
  }, [questions]);

  const counts = useMemo(() => {
    const c = { answered: 0, notAnswered: 0, marked: 0, notVisited: 0 };
    if (!questions) return c;
    questions.forEach((_, idx) => {
      const st = questionStates[idx];
      if (st === "answered") c.answered++;
      else if (st === "not-answered") c.notAnswered++;
      else if (st === "marked") c.marked++;
      else c.notVisited++;
    });
    return c;
  }, [questions, questionStates]);

  function loadQuestion(index) {
    setCurrentIndex(index);
    setQuestionStates((prev) => (prev[index] === "not-visited" ? { ...prev, [index]: "not-answered" } : prev));
    setActiveCategory(questions[index].category);
  }

  function handleSelectOption(oIdx) {
    if (lockedQuestions[currentIndex]) return;
    setUserAnswers((prev) => ({ ...prev, [currentIndex]: oIdx }));
    setQuestionStates((prev) => ({ ...prev, [currentIndex]: "answered" }));
  }

  function handleSave() {
    if (userAnswers[currentIndex] !== undefined) {
      setLockedQuestions((prev) => ({ ...prev, [currentIndex]: true }));
      setQuestionStates((prev) => ({ ...prev, [currentIndex]: "answered" }));
    }
  }

  function handleNext() {
    if (currentIndex < questions.length - 1) loadQuestion(currentIndex + 1);
  }

  function handleMarkReview() {
    setQuestionStates((prev) => ({ ...prev, [currentIndex]: "marked" }));
    if (currentIndex < questions.length - 1) loadQuestion(currentIndex + 1);
  }

  function handleClear() {
    if (lockedQuestions[currentIndex]) return;
    setUserAnswers((prev) => {
      const next = { ...prev };
      delete next[currentIndex];
      return next;
    });
    setQuestionStates((prev) => ({ ...prev, [currentIndex]: "not-answered" }));
  }

  function submitExam() {
    if (!questions) return;
    setSubmitting(true);
    const mappedQuestions = questions.map((q) => ({ ...q, section: q.category }));
    ExamAPI.submitExam({ questions: mappedQuestions, userAnswers })
      .then(() => {
        localStorage.setItem("examSummaryData", JSON.stringify({ questions: mappedQuestions, userAnswers }));
        navigate("/summary", { replace: true });
      })
      .catch((err) => {
        setSubmitting(false);
        alert(err.message || "Could not submit your exam. Please check your connection and try again.");
      });
  }
  submitRef.current = submitExam;

  // Anti-tab-switching monitor — shares the same violation counter/threshold
  // as leaving fullscreen (handleLockdownViolation above), so either action
  // counts toward the same 2-strike auto-submit.
  useEffect(() => {
    if (!ready || !questions) return undefined;
    function onVisibility() {
      if (document.hidden && localStorage.getItem("examStatus") === "locked") {
        handleLockdownViolation();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, questions]);

  // Countdown timer -> auto-submit at 0
  useEffect(() => {
    if (!ready || !questions) return undefined;
    if (timeLeft <= 0) {
      submitRef.current();
      return undefined;
    }
    const id = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(id);
  }, [ready, questions, timeLeft]);

  function handleCalcClick(val) {
    setCalcDisplay((prev) => {
      if (val === "C") return "0";
      if (val === "=") {
        try {
          // eslint-disable-next-line no-new-func
          return String(Function(`"use strict"; return (${prev})`)());
        } catch (e) {
          return "Error";
        }
      }
      return prev === "0" || prev === "Error" ? val : prev + val;
    });
  }

  if (!ready) return null;

  if (!fullscreen) {
    return (
      <FullscreenGate
        onEnter={enter}
        title="Exam Session Locked"
        message="You must enable Fullscreen Mode to continue taking your examination."
        buttonLabel="Enable Fullscreen & Resume Exam"
      />
    );
  }

  if (!questions) {
    return (
      <div className="d-flex align-items-center justify-content-center" style={{ minHeight: "100vh" }}>
        <div className="spinner-border text-primary" role="status"></div>
      </div>
    );
  }

  const q = questions[currentIndex];
  const isLocked = !!lockedQuestions[currentIndex];
  const minutes = String(Math.floor(timeLeft / 60)).padStart(2, "0");
  const seconds = String(timeLeft % 60).padStart(2, "0");

  return (
    <div style={{ background: "#f4f6f9", fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", userSelect: "none" }}>
      {/* Top Navigation */}
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2" style={{ background: "#0f172a", color: "#fff", padding: "10px 20px" }}>
        <div className="d-flex align-items-center gap-3">
          <h5 className="mb-0 text-warning"><i className="fa-solid fa-graduation-cap me-2"></i>Online Exam Portal</h5>
          <span className="badge bg-secondary">{candidateName || "Candidate Name"}</span>
        </div>
        <LiveClock style={{ backgroundColor: "rgba(255,255,255,0.1)", padding: "4px 12px", borderRadius: 6, fontSize: "0.85rem", color: "#38bdf8" }} className="d-none d-md-flex align-items-center" />
        <div className="d-flex align-items-center gap-3">
          <button className="btn btn-outline-light btn-sm" data-bs-toggle="modal" data-bs-target="#calculatorModal">
            <i className="fa-solid fa-calculator me-1"></i> Calculator
          </button>
          <div className="bg-danger text-white px-3 py-1 rounded fw-bold">
            <i className="fa-regular fa-clock me-1"></i> Time Left: {minutes}:{seconds}
          </div>
        </div>
      </div>

      <div className="container-fluid py-3">
        <div className="row">
          {/* Left: Question area */}
          <div className="col-lg-9">
            <div className="card mb-2 border-0 shadow-sm">
              <div className="card-body p-2 bg-white rounded d-flex align-items-center gap-2 flex-wrap">
                <span className="fw-bold me-2 small text-uppercase text-secondary">Sections:</span>
                <div className="btn-group flex-wrap">
                  {categories.map(({ cat, range }) => (
                    <button
                      key={cat}
                      className={`btn btn-outline-primary section-tab-btn ${activeCategory === cat ? "active" : ""}`}
                      style={activeCategory === cat ? { backgroundColor: "#0d6efd", color: "#fff" } : {}}
                      onClick={() => {
                        const firstIdx = questions.findIndex((qq) => qq.category === cat);
                        if (firstIdx !== -1) loadQuestion(firstIdx);
                      }}
                    >
                      {cat} {range}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="shadow-sm" style={{ background: "#fff", border: "1px solid #cbd5e1", borderRadius: 6, minHeight: 480, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div>
                <div className="d-flex justify-content-between align-items-center" style={{ background: "#e2e8f0", padding: "10px 15px", fontWeight: "bold" }}>
                  <span>Question No. {currentIndex + 1}</span>
                  <span className="badge bg-primary px-3 py-2">Marks: +1, -0</span>
                </div>

                <div className="p-4">
                  <h5 className="fw-semibold mb-3">{q.text}</h5>

                  {isLocked && (
                    <div className="alert alert-secondary py-2 px-3 mb-3 small">
                      <i className="fa-solid fa-lock me-2 text-warning"></i><strong>Response Locked:</strong> You have saved this response. Answers cannot be modified or cleared.
                    </div>
                  )}

                  <div>
                    {q.options.map((opt, oIdx) => (
                      <label
                        key={oIdx}
                        className="option-label"
                        style={{
                          display: "block", background: isLocked ? "#f1f5f9" : "#f8fafc", border: "1px solid #cbd5e1",
                          padding: "12px 15px", borderRadius: 6, cursor: isLocked ? "not-allowed" : "pointer", marginBottom: 10,
                          opacity: isLocked ? 0.8 : 1
                        }}
                      >
                        <input
                          type="radio"
                          className="form-check-input me-3"
                          name="mcqOption"
                          checked={userAnswers[currentIndex] === oIdx}
                          disabled={isLocked}
                          onChange={() => handleSelectOption(oIdx)}
                        />
                        <span className="option-text" style={userAnswers[currentIndex] === oIdx ? { fontWeight: "bold", color: "#0d6efd" } : {}}>
                          {String.fromCharCode(65 + oIdx)}. {opt}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="bg-light p-3 border-top d-flex justify-content-between align-items-center flex-wrap gap-2">
                <div>
                  <button className="btn btn-outline-secondary me-2" disabled={isLocked} onClick={handleClear}>
                    <i className="fa-solid fa-rotate-left me-1"></i> Clear Response
                  </button>
                  <button className="btn btn-warning text-dark" onClick={handleMarkReview}>
                    <i className="fa-solid fa-bookmark me-1"></i> Mark for Review & Next
                  </button>
                </div>
                <div>
                  <button className="btn btn-success px-4 fw-bold me-2" onClick={handleSave}>
                    <i className="fa-solid fa-floppy-disk me-1"></i> Save
                  </button>
                  <button className="btn btn-primary px-4 fw-bold" onClick={handleNext}>
                    Next <i className="fa-solid fa-chevron-right ms-1"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Palette */}
          <div className="col-lg-3 mt-3 mt-lg-0">
            <div className="shadow-sm" style={{ background: "#fff", border: "1px solid #cbd5e1", borderRadius: 6, padding: 15 }}>
              <h6 className="fw-bold mb-3 border-bottom pb-2"><i className="fa-solid fa-grid-2 me-2"></i>Question Palette</h6>

              <div className="row g-2 mb-3 small">
                <div className="col-6"><span className="status-badge bg-success" style={badgeStyle}>{counts.answered}</span> Answered</div>
                <div className="col-6"><span className="status-badge bg-danger" style={badgeStyle}>{counts.notAnswered}</span> Not Answered</div>
                <div className="col-6"><span className="status-badge" style={{ ...badgeStyle, background: "#6f42c1" }}>{counts.marked}</span> Review</div>
                <div className="col-6"><span className="status-badge bg-secondary" style={badgeStyle}>{counts.notVisited}</span> Not Visited</div>
              </div>

              <hr />

              <div className="d-flex flex-wrap justify-content-start">
                {questions.map((_, idx) => {
                  const st = questionStates[idx];
                  const bg =
                    st === "answered" ? "#198754" :
                    st === "not-answered" ? "#dc3545" :
                    st === "marked" ? "#6f42c1" : "#f1f5f9";
                  const color = st && st !== "not-visited" ? "#fff" : "#334155";
                  return (
                    <button
                      key={idx}
                      onClick={() => loadQuestion(idx)}
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

              <button className="btn btn-danger w-100 py-2 fw-bold" disabled={submitting} onClick={submitExam}>
                {submitting ? (
                  <><i className="fa-solid fa-spinner fa-spin me-2"></i>Submitting...</>
                ) : (
                  <><i className="fa-solid fa-paper-plane me-2"></i>Complete Exam</>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Calculator Modal */}
      <div className="modal fade" id="calculatorModal" tabIndex={-1} aria-hidden="true">
        <div className="modal-dialog modal-dialog-centered" style={{ width: 260 }}>
          <div className="modal-content">
            <div className="modal-header py-2 bg-dark text-white">
              <h6 className="modal-title small"><i className="fa-solid fa-calculator me-1"></i> Calculator</h6>
              <button type="button" className="btn-close btn-close-white" data-bs-dismiss="modal"></button>
            </div>
            <div className="modal-body bg-light p-3">
              <div style={{ background: "#1e293b", color: "#00ff66", fontSize: "1.5rem", textAlign: "right", padding: 10, borderRadius: 4, marginBottom: 10, minHeight: 50, overflowX: "auto" }}>
                {calcDisplay}
              </div>
              <div className="row g-2">
                {CALC_BUTTONS.flat().map((val) => {
                  const isOp = ["/", "*", "-", "+"].includes(val);
                  const isEq = val === "=";
                  const colClass = val === "0" ? "col-6" : "col-3";
                  const btnClass = isEq ? "btn-success" : isOp ? "btn-warning" : val === "C" ? "btn-secondary" : "btn-light border";
                  return (
                    <div key={val} className={colClass}>
                      <button className={`btn ${btnClass} w-100`} onClick={() => handleCalcClick(val)}>
                        {val === "/" ? "÷" : val === "*" ? "×" : val}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const badgeStyle = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 28, height: 28, borderRadius: "50%", fontSize: "0.75rem", color: "#fff", fontWeight: "bold"
};