import { useRef, useState } from "react";
import ExamAPI from "../../api";
import { formatDate } from "./analytics";
import { downloadCodingQuestionsCSV, parseCodingQuestionsCSV } from "./codingQuestionCsv";

const EMPTY_CQ_FORM = {
  title: "", difficulty: "Medium", description: "", correctOutput: "",
  ex1In: "", ex1Out: "", ex2In: "", ex2Out: "", ex3In: "", ex3Out: ""
};

function computeEndTime(startTimeStr, durationMinutes) {
  if (!startTimeStr || !durationMinutes) return "";
  const start = new Date(startTimeStr);
  if (isNaN(start.getTime())) return "";
  const end = new Date(start.getTime() + Number(durationMinutes) * 60000);
  return toDatetimeLocal(end);
}

function toDatetimeLocal(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const ROUND2_CARD_THEMES = [
  { accent: "#4f46e5", dark: "#3730a3", bg: "#eef0ff", chipBg: "#e0e3ff" },
  { accent: "#0d9488", dark: "#0f766e", bg: "#e9fbf8", chipBg: "#ccfbf1" },
  { accent: "#d97706", dark: "#b45309", bg: "#fff8ec", chipBg: "#fef3c7" },
  { accent: "#db2777", dark: "#be185d", bg: "#fff0f6", chipBg: "#fce7f3" },
  { accent: "#059669", dark: "#047857", bg: "#ecfdf5", chipBg: "#d1fae5" },
  { accent: "#2563eb", dark: "#1d4ed8", bg: "#eff6ff", chipBg: "#dbeafe" }
];

// Fixed set list for the Round 2 Question Bank's master/detail view — same
// idea as Round 1's category list, but difficulty only ever has these 3.
const DIFFICULTY_LEVELS = ["Easy", "Medium", "Hard"];

function parseArg(val) {
  try { return JSON.parse("[" + val + "]"); } catch (e) { return [val]; }
}
function parseOut(val) {
  try { return JSON.parse(val); } catch (e) { return val; }
}
function toFuncName(title) {
  const camel = title.replace(/[^a-zA-Z0-9 ]/g, "").split(/\s+/)
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join("");
  return camel || "solution" + Date.now();
}

export default function Round2Tab({ secondExams, codingQuestions, onSecondExamsChanged, onCodingQuestionsChanged }) {
  const [examForm, setExamForm] = useState({ examName: "", duration: "", testCases: "", difficulty: "Medium", startTime: "", endTime: "" });

  function handleExamSubmit(e) {
    e.preventDefault();
    ExamAPI.adminCreateSecondLevelExam({
      title: examForm.examName.trim(),
      durationMinutes: Number(examForm.duration),
      difficulty: examForm.difficulty,
      startTime: examForm.startTime || undefined,
      endTime: examForm.endTime || undefined
    })
      .then(() => {
        setExamForm({ examName: "", duration: "", testCases: "", difficulty: "Medium", startTime: "", endTime: "" });
        onSecondExamsChanged();
      })
      .catch((err) => alert(err.message || "Could not create Round 2 exam config."));
  }

  function handleExamDelete(id) {
    ExamAPI.adminDeleteSecondLevelExam(id).then(onSecondExamsChanged).catch((err) => alert(err.message || "Could not delete."));
  }

  function handleExamToggleActive(ex) {
    ExamAPI.adminUpdateSecondLevelExam(ex._id, { active: !ex.active })
      .then(onSecondExamsChanged)
      .catch((err) => alert(err.message || "Could not update status."));
  }

  const [cqForm, setCqForm] = useState(EMPTY_CQ_FORM);
  const [editingId, setEditingId] = useState(null);

  const csvInputRef = useRef(null);
  const [csvImportMsg, setCsvImportMsg] = useState("");

  function handleDownloadCodingCSV() {
    downloadCodingQuestionsCSV(codingQuestions);
  }

  function handleImportCodingClick() {
    setCsvImportMsg("");
    csvInputRef.current?.click();
  }

  function buildCqPayloadFromRow(row) {
    const funcName = toFuncName(row.title);
    return {
      title: row.title,
      difficulty: row.difficulty,
      description: row.description,
      funcName,
      correctOutput: row.correctOutput,
      examples: [
        { input: row.ex1In, output: row.ex1Out },
        { input: row.ex2In, output: row.ex2Out },
        { input: row.ex3In, output: row.ex3Out }
      ],
      starterCode: {
        javascript: `function ${funcName}(args) {\n    // write your code here\n\n}`,
        python: `def ${funcName}(args):\n    # write your code here\n    pass`,
        cpp: `#include <iostream>\nusing namespace std;\n\nvoid ${funcName}() {\n    // write your code here\n}`
      },
      testCases: [
        { input: parseArg(row.ex1In), expected: parseOut(row.ex1Out), hidden: false },
        { input: parseArg(row.ex2In), expected: parseOut(row.ex2Out), hidden: false },
        { input: parseArg(row.ex3In), expected: parseOut(row.ex3Out), hidden: false }
      ]
    };
  }

  function handleCodingCSVFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // allow re-selecting the same file next time
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const { rows, skipped } = parseCodingQuestionsCSV(String(reader.result || ""));
      if (rows.length === 0) {
        setCsvImportMsg(skipped > 0 ? `No valid rows found (${skipped} skipped — check required columns).` : "The file appears to be empty.");
        return;
      }
      const payload = rows.map(buildCqPayloadFromRow);
      ExamAPI.adminBulkCreateCodingQuestions(payload)
        .then((res) => {
          const dup = res.duplicates || 0;
          setCsvImportMsg(
            `${res.inserted} question(s) added.` +
            (dup > 0 ? ` ${dup} duplicate title(s) skipped.` : "") +
            (skipped > 0 ? ` ${skipped} row(s) skipped (missing required fields).` : "")
          );
          onCodingQuestionsChanged();
        })
        .catch((err) => setCsvImportMsg(err.message || "Could not import the file."));
    };
    reader.readAsText(file);
  }

  function startEdit(q) {
    setEditingId(q._id);
    setCqForm({
      title: q.title, difficulty: q.difficulty, description: q.description, correctOutput: q.correctOutput || "",
      ex1In: q.examples?.[0]?.input || "", ex1Out: q.examples?.[0]?.output || "",
      ex2In: q.examples?.[1]?.input || "", ex2Out: q.examples?.[1]?.output || "",
      ex3In: q.examples?.[2]?.input || "", ex3Out: q.examples?.[2]?.output || ""
    });
    window.scrollTo({ top: document.getElementById("codingQFormAnchor")?.offsetTop - 100 || 0, behavior: "smooth" });
  }

  function handleCqSubmit(e) {
    e.preventDefault();
    const funcName = toFuncName(cqForm.title.trim());
    const examples = [
      { input: cqForm.ex1In.trim(), output: cqForm.ex1Out.trim() },
      { input: cqForm.ex2In.trim(), output: cqForm.ex2Out.trim() },
      { input: cqForm.ex3In.trim(), output: cqForm.ex3Out.trim() }
    ];
    const payload = {
      title: cqForm.title.trim(),
      difficulty: cqForm.difficulty,
      description: cqForm.description.trim(),
      funcName,
      correctOutput: cqForm.correctOutput.trim(),
      examples,
      starterCode: {
        javascript: `function ${funcName}(args) {\n    // write your code here\n\n}`,
        python: `def ${funcName}(args):\n    # write your code here\n    pass`,
        cpp: `#include <iostream>\nusing namespace std;\n\nvoid ${funcName}() {\n    // write your code here\n}`
      },
      testCases: [
        { input: parseArg(cqForm.ex1In), expected: parseOut(cqForm.ex1Out), hidden: false },
        { input: parseArg(cqForm.ex2In), expected: parseOut(cqForm.ex2Out), hidden: false },
        { input: parseArg(cqForm.ex3In), expected: parseOut(cqForm.ex3Out), hidden: false }
      ]
    };
    const req = editingId ? ExamAPI.adminUpdateCodingQuestion(editingId, payload) : ExamAPI.adminCreateCodingQuestion(payload);
    req
      .then(() => {
        setEditingId(null);
        setCqForm(EMPTY_CQ_FORM);
        onCodingQuestionsChanged();
      })
      .catch((err) => alert(err.message || "Could not save coding question."));
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
      <div className="section-heading">Exam - Round 2 (Technical/Coding)</div>
      <div className="section-sub">Manage test cases, coding questions, and eligible candidates</div>

      <div className="card-box">
        <h6>Create Test Cases Exam Configuration</h6>
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
            <select className="form-select" value={examForm.difficulty} onChange={(e) => setExamForm({ ...examForm, difficulty: e.target.value })}>
              <option value="Easy">Easy</option><option value="Medium">Medium</option><option value="Hard">Hard</option>
            </select>
            <div className="form-text">Candidates get this difficulty's question set below.</div>
          </div>
          <div className="col-md-2 d-flex align-items-end">
            <button type="submit" className="btn btn-dark w-100 fw-bold">+ Add Config</button>
          </div>

          <div className="col-12"><hr className="my-1" /></div>
          <div className="col-12 small fw-bold text-uppercase text-secondary">Round 2 access window (optional — e.g. opens right when Round 1 ends)</div>
          <div className="col-md-4">
            <label className="form-label small fw-bold text-secondary">Access Opens</label>
            <input type="datetime-local" className="form-control"
              value={examForm.startTime}
              onChange={(e) => {
                const startTime = e.target.value;
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
            <input type="datetime-local" className="form-control"
              value={examForm.endTime} onChange={(e) => setExamForm({ ...examForm, endTime: e.target.value })} />
          </div>
          <div className="col-md-4 d-flex align-items-end">
            <div className="form-text mb-2">Candidates who pass Round 1 can only log in to Round 2 between these times. Leave blank for always-open access.</div>
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
                      {ex.difficulty && (
                        <span className="test-card-chip align-self-center" style={{ background: theme.chipBg, color: theme.dark }}>
                          <i className="fa-solid fa-layer-group me-1"></i>{ex.difficulty} set
                        </span>
                      )}
                    </div>

                    <div className="test-card-schedule">
                      {ex.startTime && ex.endTime ? (
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

                    <div className="small text-muted mt-1">
                      <i className="fa-regular fa-clock me-2"></i>Created {formatDate(ex.createdAt)}
                    </div>

                    <div className="d-flex flex-wrap gap-2 mt-3">
                      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => handleExamToggleActive(ex)}>
                        {ex.active ? "Deactivate" : "Activate"}
                      </button>
                      <button type="button" className="btn-clear" onClick={() => handleExamDelete(ex._id)}>Delete</button>
                    </div>
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
            <h6 className="fw-bold text-primary mb-1">{editingId ? "Edit Coding Problem" : "Manage Round 2 Coding Questions"}</h6>
            <div className="sub mb-0">Add algorithmic problems. These sync directly to the candidate's Round 2 dashboard. Exactly 3 examples are required.</div>
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
          Download the current bank as a CSV, add/edit rows in Excel (Title, Difficulty, Description, Ex1–3 Input/Output, Correct Output), then upload it back — new titles are added automatically.
        </div>

        <form className="row g-3 mt-2" onSubmit={handleCqSubmit}>
          <div className="col-md-6">
            <label className="form-label small fw-bold">Problem Title</label>
            <input type="text" className="form-control" placeholder="e.g. Find Max Element" required
              value={cqForm.title} onChange={(e) => setCqForm({ ...cqForm, title: e.target.value })} />
          </div>
          <div className="col-md-3">
            <label className="form-label small fw-bold">Difficulty</label>
            <select className="form-select" value={cqForm.difficulty} onChange={(e) => setCqForm({ ...cqForm, difficulty: e.target.value })}>
              <option value="Easy">Easy</option><option value="Medium">Medium</option><option value="Hard">Hard</option>
            </select>
          </div>
          <div className="col-12">
            <label className="form-label small fw-bold">Problem Description</label>
            <textarea className="form-control" rows={2} placeholder="Describe the problem in detail..." required
              value={cqForm.description} onChange={(e) => setCqForm({ ...cqForm, description: e.target.value })}></textarea>
          </div>

          <div className="col-md-4"><label className="form-label small fw-bold">Ex 1 Input <span className="text-muted">(Comma sep)</span></label>
            <input type="text" className="form-control border-info" placeholder="e.g. 1, 2, 3" required value={cqForm.ex1In} onChange={(e) => setCqForm({ ...cqForm, ex1In: e.target.value })} /></div>
          <div className="col-md-8"><label className="form-label small fw-bold">Ex 1 Output</label>
            <input type="text" className="form-control border-info" placeholder="e.g. 6" required value={cqForm.ex1Out} onChange={(e) => setCqForm({ ...cqForm, ex1Out: e.target.value })} /></div>

          <div className="col-md-4"><label className="form-label small fw-bold">Ex 2 Input</label>
            <input type="text" className="form-control border-warning" placeholder="e.g. -1, -2" required value={cqForm.ex2In} onChange={(e) => setCqForm({ ...cqForm, ex2In: e.target.value })} /></div>
          <div className="col-md-8"><label className="form-label small fw-bold">Ex 2 Output</label>
            <input type="text" className="form-control border-warning" placeholder="e.g. -3" required value={cqForm.ex2Out} onChange={(e) => setCqForm({ ...cqForm, ex2Out: e.target.value })} /></div>

          <div className="col-md-4"><label className="form-label small fw-bold">Ex 3 Input</label>
            <input type="text" className="form-control border-danger" placeholder="e.g. 10, 20" required value={cqForm.ex3In} onChange={(e) => setCqForm({ ...cqForm, ex3In: e.target.value })} /></div>
          <div className="col-md-8"><label className="form-label small fw-bold">Ex 3 Output</label>
            <input type="text" className="form-control border-danger" placeholder="e.g. 30" required value={cqForm.ex3Out} onChange={(e) => setCqForm({ ...cqForm, ex3Out: e.target.value })} /></div>

          <div className="col-12">
            <label className="form-label small fw-bold">Correct Output</label>
            <input type="text" className="form-control" placeholder="Expected final correct output" required
              value={cqForm.correctOutput} onChange={(e) => setCqForm({ ...cqForm, correctOutput: e.target.value })} />
          </div>

          <div className="col-12 d-flex justify-content-end gap-2 mt-4">
            {editingId && <button type="button" className="btn btn-outline-secondary fw-bold px-4" onClick={() => { setEditingId(null); setCqForm(EMPTY_CQ_FORM); }}>Cancel</button>}
            <button type="submit" className="btn btn-dark fw-bold px-5">{editingId ? "Update Coding Problem" : "+ Add Coding Problem"}</button>
          </div>
        </form>
      </div>

      <div className="card-box">
        <div className="d-flex align-items-center gap-2 mb-3 border-bottom pb-2">
          <i className="fa-solid fa-layer-group" style={{ color: "var(--brand-dark)" }}></i>
          <h6 className="fw-bold mb-0" style={{ color: "var(--brand-dark)" }}>Round 2 Question Bank</h6>
        </div>
        {codingQuestions.length === 0 ? (
          <div className="empty-state"><div className="emoji">📝</div><div>No coding questions in the bank yet.</div></div>
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
                    <thead><tr><th>Title</th><th>Correct Output</th><th>Examples (3 Required)</th><th style={{ minWidth: 140 }}>Action</th></tr></thead>
                    <tbody>
                      {(questionsByDifficulty.get(activeDifficulty) || []).slice().reverse().map((q) => {
                        const ex = q.examples || [];
                        return (
                          <tr key={q._id}>
                            <td className="fw-bold text-dark" style={{ maxWidth: 200 }}>{q.title}</td>
                            <td><code>{q.correctOutput || q.funcName}</code></td>
                            <td className="small text-muted" style={{ lineHeight: 1.6 }}>
                              <div><span className="fw-bold">Ex1:</span> In: {ex[0]?.input ?? "N/A"} | Out: {ex[0]?.output ?? "N/A"}</div>
                              <div><span className="fw-bold">Ex2:</span> In: {ex[1]?.input ?? "N/A"} | Out: {ex[1]?.output ?? "N/A"}</div>
                              <div><span className="fw-bold">Ex3:</span> In: {ex[2]?.input ?? "N/A"} | Out: {ex[2]?.output ?? "N/A"}</div>
                            </td>
                            <td>
                              <button type="button" className="btn-edit mb-1 me-1" onClick={() => startEdit(q)}>Edit</button>
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