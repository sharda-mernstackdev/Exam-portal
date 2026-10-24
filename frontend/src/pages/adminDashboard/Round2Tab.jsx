import { useEffect, useRef, useState } from "react";
import ExamAPI from "../../api";
import { formatDate } from "./analytics";
import { downloadCodingQuestionsCSV, parseCodingQuestionsCSV, titleFromQuestion } from "./codingQuestionCsv";
import DateTimePicker, { toISTISOString } from "./DateTimePicker";

// A Round 2 question is either a "Text answer" (the candidate types the answer in a
// box; it must match the correct answer exactly) or an "MCQ" (4 options).
const EMPTY_CQ_FORM = {
  type: "text", difficulty: "Medium", description: "", answer: "",
  optA: "", optB: "", optC: "", optD: "", correct: "A"
};
const OPTION_LETTERS = ["A", "B", "C", "D"];

// Given a datetime-local string ("YYYY-MM-DDTHH:mm") and a duration in
// minutes, returns the computed end datetime-local string. Returns "" if
// either input is missing/invalid. Mirrors the same helper in
// ExamManagementTab.jsx used for Round 1's Test builder.
function computeEndTime(startTimeStr, durationMinutes) {
  if (!startTimeStr || !durationMinutes) return "";
  const start = new Date(startTimeStr);
  if (isNaN(start.getTime())) return "";
  const end = new Date(start.getTime() + Number(durationMinutes) * 60000);
  return toDatetimeLocal(end);
}

// Formats a Date (or ISO string) as the "YYYY-MM-DDTHH:mm" value a
// datetime-local input expects, in the browser's local time.
function toDatetimeLocal(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Colour themes cycled per Round 2 config card, same palette used for
// Round 1's Test cards so both rounds feel visually consistent.
const ROUND2_CARD_THEMES = [
  { accent: "#4f46e5", dark: "#3730a3", bg: "#eef0ff", chipBg: "#e0e3ff" }, // indigo
  { accent: "#0d9488", dark: "#0f766e", bg: "#e9fbf8", chipBg: "#ccfbf1" }, // teal
  { accent: "#d97706", dark: "#b45309", bg: "#fff8ec", chipBg: "#fef3c7" }, // amber
  { accent: "#db2777", dark: "#be185d", bg: "#fff0f6", chipBg: "#fce7f3" }, // pink
  { accent: "#059669", dark: "#047857", bg: "#ecfdf5", chipBg: "#d1fae5" }, // emerald
  { accent: "#2563eb", dark: "#1d4ed8", bg: "#eff6ff", chipBg: "#dbeafe" }  // blue
];

// Fixed set list for the Round 2 Question Bank's master/detail view — same
// idea as Round 1's category list, but difficulty only ever has these 3.
const DIFFICULTY_LEVELS = ["Easy", "Medium", "Hard"];

// The difficulty sets a Round 2 config serves. Newer configs store a list
// (`difficulties`); older ones only have the single `difficulty` field.
function examLevels(ex) {
  if (Array.isArray(ex.difficulties) && ex.difficulties.length) return ex.difficulties;
  return ex.difficulty ? [ex.difficulty] : [];
}

const FRONTEND_URL = window.location.origin;

const EMPTY_EXAM_FORM = { examName: "", duration: "", testCases: "", difficulties: ["Medium"], startTime: "", endTime: "", loginWindowMinutes: "0", examMode: "online" };

export default function Round2Tab({ secondExams, codingQuestions, onSecondExamsChanged, onCodingQuestionsChanged }) {
  // Offline exams (Round 1 tests that have their own web address) and the Round 2
  // access code: shown on the offline Round 2 cards below, so the admin can give
  // them to the students who passed Round 1.
  const [offlineExams, setOfflineExams] = useState([]);
  const [round2Code, setRound2Code] = useState("");
  useEffect(() => {
    ExamAPI.adminGetExams()
      .then((list) => setOfflineExams((list || []).filter((x) => x.examMode === "campus" && x.slug)))
      .catch(() => { /* nothing to show */ });
    ExamAPI.adminGetSettings()
      .then((st) => setRound2Code((st && st.round2AccessCode) || ""))
      .catch(() => { /* nothing to show */ });
  }, []);

  // ---- Second-level exam config form ----
  const [examForm, setExamForm] = useState(EMPTY_EXAM_FORM);
  const [editingExamId, setEditingExamId] = useState(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const diffBoxRef = useRef(null);
  useEffect(() => {
    if (!diffOpen) return undefined;
    const onDown = (e) => {
      if (diffBoxRef.current && !diffBoxRef.current.contains(e.target)) setDiffOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [diffOpen]);

  function startEditExam(ex) {
    setEditingExamId(ex._id);
    setExamForm({
      examName: ex.title,
      duration: String(ex.durationMinutes || ""),
      testCases: "",
      difficulties: examLevels(ex).length ? examLevels(ex) : ["Medium"],
      startTime: toDatetimeLocal(ex.startTime),
      endTime: toDatetimeLocal(ex.endTime),
      loginWindowMinutes: String(ex.loginWindowMinutes || 0),
      examMode: ex.examMode || "online"
    });
    document.getElementById("round2ExamFormAnchor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function cancelEditExam() {
    setEditingExamId(null);
    setExamForm(EMPTY_EXAM_FORM);
  }

  function handleExamSubmit(e) {
    e.preventDefault();
    if (examForm.difficulties.length === 0) {
      alert("Please tick at least one difficulty (Easy / Medium / Hard).");
      return;
    }
    // Keep the levels in Easy -> Hard order; `difficulty` = the first one, for older code.
    const levels = DIFFICULTY_LEVELS.filter((d) => examForm.difficulties.includes(d));
    const offline = examForm.examMode === "campus";
    const payload = {
      title: examForm.examName.trim(),
      durationMinutes: Number(examForm.duration),
      difficulties: levels,
      difficulty: levels[0],
      examMode: examForm.examMode || "online",
      // An offline exam has no access window: the students enter with their
      // email + the Round 2 access code at the exam's own Round 2 address.
      loginWindowMinutes: offline ? 0 : Math.max(0, Number(examForm.loginWindowMinutes) || 0),
      startTime: offline ? null : (toISTISOString(examForm.startTime) || undefined),
      endTime: offline ? null : (toISTISOString(examForm.endTime) || undefined)
    };
    const req = editingExamId
      ? ExamAPI.adminUpdateSecondLevelExam(editingExamId, payload)
      : ExamAPI.adminCreateSecondLevelExam(payload);
    req
      .then(() => {
        setEditingExamId(null);
        setExamForm(EMPTY_EXAM_FORM);
        onSecondExamsChanged();
      })
      .catch((err) => alert(err.message || "Could not save Round 2 exam config."));
  }

  function copyRound2Link() {
    const link = `${window.location.origin}/round2-login`;
    navigator.clipboard.writeText(link)
      .then(() => alert("Round 2 link copied:\n" + link))
      .catch(() => prompt("Copy this Round 2 link:", link));
  }

  function handleExamDelete(id) {
    ExamAPI.adminDeleteSecondLevelExam(id).then(onSecondExamsChanged).catch((err) => alert(err.message || "Could not delete."));
  }

  function handleExamToggleActive(ex) {
    ExamAPI.adminUpdateSecondLevelExam(ex._id, { active: !ex.active })
      .then(onSecondExamsChanged)
      .catch((err) => alert(err.message || "Could not update status."));
  }

  // ---- "View registrations" (Round 2 has no per-exam registration step —
  // any student who passes Round 1 becomes globally eligible, not tied to a
  // specific config — so this shows the full list of Round-2-eligible
  // candidates and their attempt status, same data for every config card). ----
  const [openCandidatesFor, setOpenCandidatesFor] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);

  function toggleCandidates(examId) {
    if (openCandidatesFor === examId) {
      setOpenCandidatesFor(null);
      return;
    }
    setOpenCandidatesFor(examId);
    setCandidatesLoading(true);
    ExamAPI.adminGetCandidateJourney()
      .then((rows) => setCandidates(rows.filter((r) => r.round2Eligible)))
      .catch((err) => alert(err.message || "Could not load candidates."))
      .finally(() => setCandidatesLoading(false));
  }

  const ROUND2_STATUS_CLASS = { PASS: "pass", FAIL: "fail" };

  // ---- Coding question form ----
  const [cqForm, setCqForm] = useState(EMPTY_CQ_FORM);
  const [editingId, setEditingId] = useState(null);

  // ---- Coding question bank CSV import/export ----
  const csvInputRef = useRef(null);
  const [csvImportMsg, setCsvImportMsg] = useState("");

  function handleDownloadCodingCSV() {
    downloadCodingQuestionsCSV(codingQuestions);
  }

  function handleImportCodingClick() {
    setCsvImportMsg("");
    csvInputRef.current?.click();
  }

  function handleCodingCSVFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // allow re-selecting the same file next time
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const { questions, skipped } = parseCodingQuestionsCSV(String(reader.result || ""));
      if (questions.length === 0) {
        setCsvImportMsg(skipped > 0 ? `No valid rows found (${skipped} skipped - check the columns).` : "The file appears to be empty.");
        return;
      }
      ExamAPI.adminBulkCreateCodingQuestions(questions)
        .then((res) => {
          const dup = res.duplicates || 0;
          setCsvImportMsg(
            `${res.inserted} question(s) added.` +
            (dup > 0 ? ` ${dup} duplicate question(s) skipped.` : "") +
            (skipped > 0 ? ` ${skipped} row(s) skipped (missing or wrong fields).` : "")
          );
          onCodingQuestionsChanged();
        })
        .catch((err) => setCsvImportMsg(err.message || "Could not import the file."));
    };
    reader.readAsText(file);
  }

  function startEdit(q) {
    if (q.type !== "text" && q.type !== "mcq") return;
    setEditingId(q._id);
    const o = q.options || [];
    setCqForm({
      type: q.type, difficulty: q.difficulty, description: q.description, answer: q.answer || "",
      optA: o[0] || "", optB: o[1] || "", optC: o[2] || "", optD: o[3] || "",
      correct: OPTION_LETTERS[q.correctIndex] || "A"
    });
    window.scrollTo({ top: document.getElementById("codingQFormAnchor")?.offsetTop - 100 || 0, behavior: "smooth" });
  }

  function handleCqSubmit(e) {
    e.preventDefault();
    const description = cqForm.description.trim();
    let payload;
    if (cqForm.type === "text") {
      payload = {
        type: "text", title: titleFromQuestion(description), difficulty: cqForm.difficulty,
        description, answer: cqForm.answer.trim()
      };
    } else {
      const raw = [cqForm.optA, cqForm.optB, cqForm.optC, cqForm.optD].map((x) => x.trim());
      const options = raw.filter((x) => x !== "");
      const correctText = raw[OPTION_LETTERS.indexOf(cqForm.correct)];
      if (options.length < 2) { alert("Please fill at least 2 options."); return; }
      if (!correctText) { alert("The correct option is empty. Choose a filled option as correct."); return; }
      payload = {
        type: "mcq", title: titleFromQuestion(description), difficulty: cqForm.difficulty,
        description, options, correctIndex: options.indexOf(correctText)
      };
    }
    const req = editingId ? ExamAPI.adminUpdateCodingQuestion(editingId, payload) : ExamAPI.adminCreateCodingQuestion(payload);
    req
      .then(() => {
        setEditingId(null);
        setCqForm(EMPTY_CQ_FORM);
        onCodingQuestionsChanged();
      })
      .catch((err) => alert(err.message || "Could not save the question."));
  }

  function handleCqDelete(id) {
    ExamAPI.adminDeleteCodingQuestion(id).then(onCodingQuestionsChanged).catch((err) => alert(err.message || "Could not delete."));
  }

  // ---- Question Bank set list (same master/detail layout as Round 1's
  // Question Bank: a left-side list of "sets" you click through, instead of
  // one giant flat table). Round 1 groups by category (Aptitude, Verbal...);
  // here the sets are the fixed Easy/Medium/Hard difficulty levels.
  const questionsByDifficulty = new Map(DIFFICULTY_LEVELS.map((d) => [d, []]));
  codingQuestions.forEach((q) => {
    const key = DIFFICULTY_LEVELS.includes(q.difficulty) ? q.difficulty : "Medium";
    questionsByDifficulty.get(key).push(q);
  });

  const [selectedDifficulty, setSelectedDifficulty] = useState(null);
  const activeDifficulty = selectedDifficulty && DIFFICULTY_LEVELS.includes(selectedDifficulty)
    ? selectedDifficulty
    : DIFFICULTY_LEVELS[0];

  return (
    <section className="page-section active">
      <div className="section-heading">Exam - Round 2 (Written / MCQ)</div>
      <div className="section-sub">Manage Round 2 exam setup, questions (text answer + MCQ), and eligible candidates</div>

      <div className="card-box" id="round2ExamFormAnchor">
        <h6>{editingExamId ? "Edit Test Cases Exam Configuration" : "Create Test Cases Exam Configuration"}</h6>
        <div className="sub">Set up a coding / test-cases round for shortlisted candidates</div>
        <form className="row g-3" onSubmit={handleExamSubmit}>
          <div className="col-md-4">
            <label className="form-label small fw-bold text-secondary">Exam Name</label>
            <input type="text" className="form-control" placeholder="e.g. Test Cases Round 1" required
              value={examForm.examName} onChange={(e) => setExamForm({ ...examForm, examName: e.target.value })} />
          </div>
          <div className="col-md-2">
            <label className="form-label small fw-bold text-secondary">Duration (mins)</label>
            <input type="number" className="form-control" min="1" placeholder="45" required
              value={examForm.duration}
              onChange={(e) => {
                const duration = e.target.value;
                setExamForm((prev) => ({
                  ...prev,
                  duration,
                  endTime: prev.startTime ? computeEndTime(prev.startTime, duration) : prev.endTime
                }));
              }} />
          </div>
          <div className="col-md-2">
            <label className="form-label small fw-bold text-secondary">Test Cases</label>
            <input type="number" className="form-control" min="1" placeholder="10" required
              value={examForm.testCases} onChange={(e) => setExamForm({ ...examForm, testCases: e.target.value })} />
          </div>
          <div className="col-md-2">
            <label className="form-label small fw-bold text-secondary">Difficulty</label>
            <div className="position-relative" ref={diffBoxRef}>
            <button type="button" className="form-select text-start bg-white"
              onClick={() => setDiffOpen((o) => !o)} aria-expanded={diffOpen}>
              {DIFFICULTY_LEVELS.filter((d) => examForm.difficulties.includes(d)).join(", ") || "Select difficulty"}
            </button>
            {diffOpen && (
            <div className="border rounded px-3 py-2 bg-white shadow position-absolute w-100"
              style={{ zIndex: 20, top: "100%", left: 0 }}>
              {DIFFICULTY_LEVELS.map((d) => (
                <div className="form-check" key={d}>
                  <input
                    type="checkbox"
                    className="form-check-input"
                    id={`round2Diff-${d}`}
                    checked={examForm.difficulties.includes(d)}
                    onChange={(e) =>
                      setExamForm((prev) => ({
                        ...prev,
                        difficulties: e.target.checked
                          ? [...prev.difficulties, d]
                          : prev.difficulties.filter((x) => x !== d)
                      }))
                    } />
                  <label className="form-check-label" htmlFor={`round2Diff-${d}`}>{d}</label>
                </div>
              ))}
            </div>
            )}
            </div>
            <div className="form-text">Tick one or more. Candidates get questions from all ticked sets.</div>
          </div>
          <div className="col-md-4">
            <label className="form-label small fw-bold text-secondary">Exam Mode</label>
            <select className="form-select" value={examForm.examMode} onChange={(e) => setExamForm({ ...examForm, examMode: e.target.value })}>
              <option value="online">Online exam</option>
              <option value="campus">Offline exam (campus drive) — own Round 2 address, no time window</option>
            </select>
          </div>
          {examForm.examMode === "campus" && (
            <div className="col-md-8 d-flex align-items-end">
              <div className="small text-muted">Offline exam: no access window needed. Students open the exam's Round 2 address (shown on its card below) and enter their email + the Round 2 access code.</div>
            </div>
          )}
          {examForm.examMode !== "campus" && (
            <>
          <div className="col-12"><hr className="my-1" /></div>
          <div className="col-12 small fw-bold text-uppercase text-secondary">Round 2 access window (optional — e.g. opens right when Round 1 ends)</div>
          <div className="col-md-4">
            <label className="form-label small fw-bold text-secondary">Access Opens</label>
            <DateTimePicker
              value={examForm.startTime}
              onChange={(startTime) => {
                setExamForm((prev) => ({
                  ...prev,
                  startTime,
                  endTime: prev.duration ? computeEndTime(startTime, prev.duration) : prev.endTime
                }));
              }} />
          </div>
          <div className="col-md-4">
            <label className="form-label small fw-bold text-secondary">
              Access Closes <span className="text-muted fw-normal">(auto-calculated — edit if needed)</span>
            </label>
            <DateTimePicker
              value={examForm.endTime} onChange={(endTime) => setExamForm({ ...examForm, endTime })} />
          </div>
          <div className="col-md-4">
            <label className="form-label small fw-bold text-secondary">Login Window (mins before start)</label>
            <input type="number" className="form-control" min="0" placeholder="0"
              value={examForm.loginWindowMinutes}
              onChange={(e) => setExamForm({ ...examForm, loginWindowMinutes: e.target.value })} />
            <div className="form-text">Candidates can log in this many minutes before "Access Opens" (0 = exactly at Access Opens). Leave the dates blank for always-open access.</div>
          </div>
            </>
          )}
          <div className="col-12 d-flex gap-2 flex-wrap">
            <button type="submit" className="btn btn-dark fw-bold px-4">{editingExamId ? "Save Changes" : "Save"}</button>
            {editingExamId && (
              <button type="button" className="btn btn-outline-secondary fw-bold" onClick={cancelEditExam}>Cancel Edit</button>
            )}
          </div>
        </form>
      </div>

      <div className="card-box">
        <h6>Round 2 Configured Exams</h6>
        <div className="sub">Test-cases based exams configured for the second round. Only candidates who passed Round 1 can access these.</div>
        {secondExams.length === 0 ? (
          <div className="empty-state"><div className="emoji">🎯</div><div>No second level configs created yet.</div></div>
        ) : (
          <div className="row g-3 mt-1">
            {secondExams.slice().reverse().map((ex, idx) => {
              const theme = ROUND2_CARD_THEMES[idx % ROUND2_CARD_THEMES.length];
              const levels = examLevels(ex);
              const qCount = levels.reduce((sum, d) => sum + (questionsByDifficulty.get(d) || []).filter((q) => q.type === "text" || q.type === "mcq").length, 0);
              return (
                <div className="col-md-6 col-lg-4" key={ex._id}>
                  <div className="test-card" style={{ borderTop: `5px solid ${theme.accent}`, background: theme.bg }}>
                    <div className="d-flex justify-content-between align-items-start mb-2">
                      <span className="badge-pill" style={{ background: theme.accent, color: "#fff", letterSpacing: "0.04em" }}>
                        <i className="fa-solid fa-code me-1"></i>ROUND 2
                      </span>
                      <span className={`badge-pill ${ex.active ? "pass" : "fail"}`}>{ex.active ? "Active" : "Inactive"}</span>
                    </div>

                    <div className="test-card-title" style={{ color: theme.dark }}>{ex.title}</div>

                    <div className="d-flex gap-2 my-2">
                      <div className="test-card-stat" style={{ borderColor: theme.accent }}>
                        <div className="test-card-stat-value" style={{ color: theme.dark }}>{ex.durationMinutes}</div>
                        <div className="test-card-stat-label">minutes</div>
                      </div>
                      <div className="test-card-stat" style={{ borderColor: theme.accent }}>
                        <div className="test-card-stat-value" style={{ color: theme.dark }}>{qCount}</div>
                        <div className="test-card-stat-label">questions</div>
                      </div>
                      {levels.length > 0 && (
                        <span className="test-card-chip align-self-center" style={{ background: theme.chipBg, color: theme.dark }}>
                          <i className="fa-solid fa-layer-group me-1"></i>{levels.join(" + ")} {levels.length > 1 ? "sets" : "set"}
                        </span>
                      )}
                    </div>

                    <div className="test-card-schedule">
                      {ex.examMode === "campus" ? (
                        <span className="text-muted"><i className="fa-solid fa-calendar-xmark me-2"></i>Not scheduled</span>
                      ) : ex.startTime && ex.endTime ? (
                        <>
                          <i className="fa-solid fa-calendar-days me-2" style={{ color: theme.accent }}></i>
                          {formatDate(ex.startTime)}, {new Date(ex.startTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                          {" "}–{" "}
                          {new Date(ex.endTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                        </>
                      ) : (
                        <span className="text-muted"><i className="fa-solid fa-calendar-xmark me-2"></i>Always open (no access window set)</span>
                      )}
                    </div>

                    <div className="test-card-schedule mt-2">
                      {ex.examMode === "campus" ? (
                        <><i className="fa-solid fa-building-columns me-2" style={{ color: theme.accent }}></i>Campus Drive</>
                      ) : (
                        <><i className="fa-solid fa-laptop me-2" style={{ color: theme.accent }}></i>Online Exam</>
                      )}
                    </div>

                    {ex.examMode === "campus" && (
                      <div className="mt-2 small">
                        {offlineExams.length === 0 ? (
                          <div className="border-top pt-1 mt-1 text-muted">No offline Round 1 exam yet — create one in Exam → Round 1.</div>
                        ) : offlineExams.map((t) => (
                          <div key={t._id} className="d-flex justify-content-between gap-2 border-top pt-1 mt-1">
                            <span className="text-break">Round 2: <b>{FRONTEND_URL}/{t.slug}/round-2</b></span>
                            <button type="button" className="btn btn-sm btn-outline-primary py-0" onClick={() => navigator.clipboard && navigator.clipboard.writeText(`${FRONTEND_URL}/${t.slug}/round-2`).then(() => alert("Round 2 address copied."))}>Copy</button>
                          </div>
                        ))}
                        <div className="border-top pt-1 mt-1">
                          Access code: {round2Code ? <b style={{ letterSpacing: 2 }}>{round2Code}</b> : <span className="text-danger">not set — set it in Settings</span>}
                        </div>
                      </div>
                    )}

                    <div className="small text-muted mt-1">
                      <i className="fa-regular fa-clock me-2"></i>Created {formatDate(ex.createdAt)}
                    </div>

                    <div className="d-flex flex-wrap gap-2 mt-3">
                      {ex.examMode !== "campus" && (
                        <button type="button" className="btn btn-sm btn-outline-primary" onClick={copyRound2Link}>
                          <i className="fa-solid fa-link me-1"></i>Copy link
                        </button>
                      )}
                      <button type="button" className="btn-edit" onClick={() => startEditExam(ex)}>Edit</button>
                      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => toggleCandidates(ex._id)}>
                        {openCandidatesFor === ex._id ? "Hide registrations" : "View registrations"}
                      </button>
                      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => handleExamToggleActive(ex)}>
                        {ex.active ? "Deactivate" : "Activate"}
                      </button>
                      <button type="button" className="btn-clear" onClick={() => handleExamDelete(ex._id)}>Delete</button>
                    </div>

                    {openCandidatesFor === ex._id && (
                      <div className="mt-3 pt-3 border-top">
                        <div className="small fw-bold text-secondary mb-2">
                          Round 2 eligible candidates <span className="text-muted fw-normal">(passed Round 1 — same list for every config, Round 2 has no per-config registration)</span>
                        </div>
                        {candidatesLoading ? (
                          <div className="small text-muted">Loading...</div>
                        ) : candidates.length === 0 ? (
                          <div className="small text-muted">No candidates are eligible for Round 2 yet.</div>
                        ) : (
                          <div className="table-responsive">
                            <table className="table candidates-table mb-0 align-middle">
                              <thead>
                                <tr><th>Name</th><th>Email</th><th>Round 1</th><th>Round 2</th><th>Final Status</th></tr>
                              </thead>
                              <tbody>
                                {candidates.map((c) => (
                                  <tr key={c.studentId}>
                                    <td className="fw-bold text-dark">{c.name}</td>
                                    <td className="small">{c.email}</td>
                                    <td>
                                      {c.round1 ? (
                                        <span className={`badge-pill ${ROUND2_STATUS_CLASS[c.round1.status] || ""}`}>
                                          {c.round1.status} ({c.round1.percentage}%)
                                        </span>
                                      ) : <span className="text-muted small">—</span>}
                                    </td>
                                    <td>
                                      {c.round2 ? (
                                        <span className={`badge-pill ${ROUND2_STATUS_CLASS[c.round2.status] || ""}`}>{c.round2.status}</span>
                                      ) : <span className="text-muted small">Not attempted</span>}
                                    </td>
                                    <td className="small">{c.finalStatus || "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card-box mt-4 border-top border-4 border-primary" id="codingQFormAnchor">
        <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
          <div>
            <h6 className="fw-bold text-primary mb-1">{editingId ? "Edit Round 2 Question" : "Manage Round 2 Questions"}</h6>
            <div className="sub mb-0">Add Text-answer questions (the candidate types the answer in a box) and MCQs. MCQs are shown in between the text questions automatically.</div>
          </div>
          <div className="d-flex gap-2">
            <button type="button" className="btn btn-sm btn-outline-secondary fw-bold" onClick={handleDownloadCodingCSV}>
              <i className="fa-solid fa-file-arrow-down me-1"></i>Download CSV
            </button>
            <button type="button" className="btn btn-sm btn-outline-primary fw-bold" onClick={handleImportCodingClick}>
              <i className="fa-solid fa-file-arrow-up me-1"></i>Upload CSV
            </button>
            <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="d-none" onChange={handleCodingCSVFileSelected} />
          </div>
        </div>
        {csvImportMsg && <div className="small text-secondary mt-2">{csvImportMsg}</div>}
        <div className="form-text mt-1">
          CSV columns: Type (Text / MCQ), Difficulty, Question, Correct Answer (Text only), Option A-D and Correct Option (A-D) (MCQ only). New questions are added automatically; the same question is not added twice.
        </div>

        <form className="row g-3 mt-2" onSubmit={handleCqSubmit}>
          <div className="col-md-4">
            <label className="form-label small fw-bold">Question Type</label>
            <select className="form-select" value={cqForm.type} onChange={(e) => setCqForm({ ...cqForm, type: e.target.value })}>
              <option value="text">Text answer (type in a box)</option>
              <option value="mcq">MCQ (choose an option)</option>
            </select>
          </div>
          <div className="col-md-3">
            <label className="form-label small fw-bold">Difficulty (Set)</label>
            <select className="form-select" value={cqForm.difficulty} onChange={(e) => setCqForm({ ...cqForm, difficulty: e.target.value })}>
              <option value="Easy">Easy</option><option value="Medium">Medium</option><option value="Hard">Hard</option>
            </select>
          </div>
          <div className="col-12">
            <label className="form-label small fw-bold">Question</label>
            <textarea className="form-control" rows={3} placeholder="Write the question here..." required
              value={cqForm.description} onChange={(e) => setCqForm({ ...cqForm, description: e.target.value })}></textarea>
          </div>

          {cqForm.type === "text" ? (
            <div className="col-12">
              <label className="form-label small fw-bold">Correct Answer</label>
              <textarea className="form-control" rows={2} placeholder="The candidate's answer must be exactly this" required
                value={cqForm.answer} onChange={(e) => setCqForm({ ...cqForm, answer: e.target.value })}></textarea>
              <div className="form-text">The answer is marked correct only if it matches this exactly (capital / small letters count). Extra spaces and line breaks are ignored.</div>
            </div>
          ) : (
            <>
              {OPTION_LETTERS.map((L) => {
                const key = "opt" + L;
                return (
                  <div className="col-md-6" key={L}>
                    <label className="form-label small fw-bold">Option {L}{L === "A" || L === "B" ? "" : " (optional)"}</label>
                    <input type="text" className="form-control" required={L === "A" || L === "B"}
                      value={cqForm[key]} onChange={(e) => setCqForm({ ...cqForm, [key]: e.target.value })} />
                  </div>
                );
              })}
              <div className="col-md-4">
                <label className="form-label small fw-bold">Correct Option</label>
                <select className="form-select" value={cqForm.correct} onChange={(e) => setCqForm({ ...cqForm, correct: e.target.value })}>
                  {OPTION_LETTERS.map((L) => <option key={L} value={L}>Option {L}</option>)}
                </select>
              </div>
            </>
          )}

          <div className="col-12 d-flex justify-content-end gap-2 mt-4">
            {editingId && <button type="button" className="btn btn-outline-secondary fw-bold px-4" onClick={() => { setEditingId(null); setCqForm(EMPTY_CQ_FORM); }}>Cancel</button>}
            <button type="submit" className="btn btn-dark fw-bold px-5">{editingId ? "Update Question" : "+ Add Question"}</button>
          </div>
        </form>
      </div>

      <div className="card-box">
        <div className="d-flex align-items-center gap-2 mb-3 border-bottom pb-2">
          <i className="fa-solid fa-layer-group" style={{ color: "var(--brand-dark)" }}></i>
          <h6 className="fw-bold mb-0" style={{ color: "var(--brand-dark)" }}>Round 2 Question Bank</h6>
        </div>
        {codingQuestions.length === 0 ? (
          <div className="empty-state"><div className="emoji">📝</div><div>No Round 2 questions in the bank yet.</div></div>
        ) : (
          <div className="row g-4">
            <div className="col-md-4 order-1">
              <div className="qbank-set-heading">Question Sets</div>
              <div className="qbank-set-list">
                {DIFFICULTY_LEVELS.map((d, idx) => {
                  const count = (questionsByDifficulty.get(d) || []).length;
                  const isActive = d === activeDifficulty;
                  const theme = ROUND2_CARD_THEMES[idx % ROUND2_CARD_THEMES.length];
                  return (
                    <button
                      key={d}
                      type="button"
                      className={`qbank-set-item${isActive ? " active" : ""}`}
                      style={{
                        borderLeftColor: theme.accent,
                        background: isActive ? theme.accent : "#fff"
                      }}
                      onClick={() => setSelectedDifficulty(d)}
                    >
                      <span className="qbank-set-icon" style={{ background: isActive ? "rgba(255,255,255,0.25)" : theme.chipBg, color: isActive ? "#fff" : theme.dark }}>
                        <i className="fa-solid fa-layer-group"></i>
                      </span>
                      <span className="qbank-set-name">{d}</span>
                      <span className="qbank-set-count" style={{ background: isActive ? "rgba(255,255,255,0.25)" : theme.chipBg, color: isActive ? "#fff" : theme.dark }}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="col-md-8 order-2">
              <div className="d-flex align-items-center justify-content-between mb-3">
                <div className="d-flex align-items-center gap-2">
                  <span className="qbank-active-badge">
                    <i className="fa-solid fa-layer-group me-2"></i>{activeDifficulty}
                  </span>
                  <span className="text-muted small">{(questionsByDifficulty.get(activeDifficulty) || []).length} question(s)</span>
                </div>
              </div>
              {(questionsByDifficulty.get(activeDifficulty) || []).length === 0 ? (
                <div className="empty-state"><div className="emoji">🗂️</div><div>No questions in this set yet.</div></div>
              ) : (
                <div className="table-responsive">
                  <table className="table candidates-table mb-0 align-middle">
                    <thead><tr><th style={{ width: 90 }}>Type</th><th>Question</th><th>Correct Answer</th><th style={{ minWidth: 140 }}>Action</th></tr></thead>
                    <tbody>
                      {(questionsByDifficulty.get(activeDifficulty) || []).slice().reverse().map((q) => {
                        const oldCode = q.type !== "text" && q.type !== "mcq";
                        return (
                          <tr key={q._id} style={oldCode ? { opacity: 0.6 } : undefined}>
                            <td>
                              <span className="badge bg-secondary">{q.type === "mcq" ? "MCQ" : q.type === "text" ? "Text" : "Old code"}</span>
                            </td>
                            <td className="text-dark" style={{ maxWidth: 320, whiteSpace: "pre-wrap" }}>
                              {q.description}
                              {q.type === "mcq" && (
                                <div className="small text-muted mt-1">
                                  {(q.options || []).map((o, i) => <div key={i}>{OPTION_LETTERS[i]}. {o}</div>)}
                                </div>
                              )}
                            </td>
                            <td>
                              {q.type === "mcq" ? <code>{OPTION_LETTERS[q.correctIndex]}. {(q.options || [])[q.correctIndex]}</code>
                                : q.type === "text" ? <code style={{ whiteSpace: "pre-wrap" }}>{q.answer}</code>
                                : <span className="small text-muted">Not used in Round 2 now</span>}
                            </td>
                            <td>
                              {!oldCode && <button type="button" className="btn-edit mb-1 me-1" onClick={() => startEdit(q)}>Edit</button>}
                              <button type="button" className="btn-clear" onClick={() => handleCqDelete(q._id)}>Delete</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}