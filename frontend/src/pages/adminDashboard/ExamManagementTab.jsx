import { Fragment, useRef, useState } from "react";
import ExamAPI from "../../api";
import { formatDate } from "./analytics";
import { downloadQuestionsCSV, parseQuestionsCSV } from "./questionCsv";
import DateTimePicker, { toISTISOString } from "./DateTimePicker";

const EMPTY_QUESTION_FORM = { category: "", text: "", optA: "", optB: "", optC: "", optD: "", correct: "0" };
const FRONTEND_URL = window.location.origin;

// Given a datetime-local string ("YYYY-MM-DDTHH:mm") and a duration in
// minutes, returns the computed end datetime-local string. Returns "" if
// either input is missing/invalid.
function computeEndTime(startTimeStr, durationMinutes) {
  if (!startTimeStr || !durationMinutes) return "";
  const start = new Date(startTimeStr);
  if (isNaN(start.getTime())) return "";
  const end = new Date(start.getTime() + Number(durationMinutes) * 60000);
  return toDatetimeLocal(end);
}

// Formats a Date (or ISO string) as the "YYYY-MM-DDTHH:mm" value a
// datetime-local input expects, in the browser's local time. Returns "" for
// anything missing/invalid — used both for the auto-calculated End Time and
// for pre-filling the edit form from a saved test's stored dates.
function toDatetimeLocal(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EMPTY_TEST_FORM = {
  name: "", status: "Active", sectionIds: [],
  examDate: "", startTime: "", endTime: "", loginWindowMinutes: "5", instructions: ""
};

const EMPTY_EXAM_FORM = { examName: "", duration: "", totalQuestions: "", status: "Active" };

// Colour themes cycled per Test card, so when many combined tests exist
// they're visually distinct at a glance (tab-wise colour coding) instead of
// all looking like identical rows.
const TEST_CARD_THEMES = [
  { accent: "#4f46e5", dark: "#3730a3", bg: "#eef0ff", chipBg: "#e0e3ff" }, // indigo
  { accent: "#0d9488", dark: "#0f766e", bg: "#e9fbf8", chipBg: "#ccfbf1" }, // teal
  { accent: "#d97706", dark: "#b45309", bg: "#fff8ec", chipBg: "#fef3c7" }, // amber
  { accent: "#db2777", dark: "#be185d", bg: "#fff0f6", chipBg: "#fce7f3" }, // pink
  { accent: "#059669", dark: "#047857", bg: "#ecfdf5", chipBg: "#d1fae5" }, // emerald
  { accent: "#2563eb", dark: "#1d4ed8", bg: "#eff6ff", chipBg: "#dbeafe" }  // blue
];

export default function ExamManagementTab({ exams, questions, onExamsChanged, onQuestionsChanged }) {
  // ---- Exam create form (question SETS only — no scheduling here; a set
  // like "Aptitude" or "Reasoning" is just a bucket of questions. Scheduling
  // belongs to the combined Test built from these sets, below.) ----
  const [examForm, setExamForm] = useState(EMPTY_EXAM_FORM);
  const [editingExamId, setEditingExamId] = useState(null);

  function startEditExam(ex) {
    setEditingExamId(ex._id);
    setExamForm({
      examName: ex.title,
      duration: String(ex.durationMinutes || ""),
      totalQuestions: String(ex.totalQuestionsTarget || ""),
      status: ex.active ? "Active" : "Inactive"
    });
    window.scrollTo({ top: document.getElementById("examFormAnchor")?.offsetTop - 100 || 0, behavior: "smooth" });
  }

  function cancelEditExam() {
    setEditingExamId(null);
    setExamForm(EMPTY_EXAM_FORM);
  }

  function handleExamSubmit(e) {
    e.preventDefault();
    const payload = {
      title: examForm.examName.trim(),
      durationMinutes: Number(examForm.duration),
      qualifyingPct: 70,
      totalQuestionsTarget: Number(examForm.totalQuestions) || 0,
      active: examForm.status === "Active"
    };
    const req = editingExamId ? ExamAPI.adminUpdateExam(editingExamId, payload) : ExamAPI.adminCreateExam(payload);
    req
      .then(() => {
        setEditingExamId(null);
        setExamForm(EMPTY_EXAM_FORM);
        onExamsChanged();
      })
      .catch((err) => alert(err.message || (editingExamId ? "Could not update exam." : "Could not create exam.")));
  }

  function handleExamDelete(id) {
    ExamAPI.adminDeleteExam(id).then(onExamsChanged).catch((err) => alert(err.message || "Could not delete exam."));
  }

  // Jumps to the Question Bank form with this set's category pre-selected,
  // so "add a question to Aptitude" is a single click from the table.
  function goAddQuestionFor(category) {
    setQForm((prev) => ({ ...prev, category }));
    window.scrollTo({ top: document.getElementById("qBankFormAnchor")?.offsetTop - 100 || 0, behavior: "smooth" });
  }


  function handleExamToggleActive(ex) {
    ExamAPI.adminUpdateExam(ex._id, { active: !ex.active })
      .then(onExamsChanged)
      .catch((err) => alert(err.message || "Could not update exam status."));
  }

  function copyRegistrationLink(examId) {
    const link = `${FRONTEND_URL}/register/${examId}`;
    navigator.clipboard.writeText(link)
      .then(() => alert("Registration link copied:\n" + link))
      .catch(() => prompt("Copy this registration link:", link));
  }

  // ---- Combined "Test" builder (select existing sections, duration auto-sums) ----
  // A "section" is a plain exam (no sectionIds of its own) — these are the
  // building blocks a Test is made from.
  const sectionExams = exams.filter((ex) => !ex.sectionIds || ex.sectionIds.length === 0);
  const testExams = exams.filter((ex) => ex.sectionIds && ex.sectionIds.length > 0);

  const [testForm, setTestForm] = useState(EMPTY_TEST_FORM);
  const [editingTestId, setEditingTestId] = useState(null);

  function startEditTest(t) {
    setEditingTestId(t._id);
    setTestForm({
      name: t.title,
      status: t.active ? "Active" : "Inactive",
      sectionIds: (t.sectionIds || []).map((s) => (typeof s === "string" ? s : s._id)),
      examDate: t.examDate ? String(t.examDate).slice(0, 10) : "",
      startTime: toDatetimeLocal(t.startTime),
      endTime: toDatetimeLocal(t.endTime),
      loginWindowMinutes: String(t.loginWindowMinutes || 5),
      instructions: t.instructions || ""
    });
    window.scrollTo({ top: document.getElementById("testBuilderAnchor")?.offsetTop - 100 || 0, behavior: "smooth" });
  }

  function cancelEditTest() {
    setEditingTestId(null);
    setTestForm(EMPTY_TEST_FORM);
    setPendingSectionId("");
  }

  function setTestSections(sectionIds) {
    setTestForm((prev) => {
      const newTotalDuration = sectionExams
        .filter((ex) => sectionIds.includes(ex._id))
        .reduce((sum, ex) => sum + (ex.durationMinutes || 0), 0);
      return {
        ...prev,
        sectionIds,
        endTime: prev.startTime ? computeEndTime(prev.startTime, newTotalDuration) : prev.endTime
      };
    });
  }

  // Dropdown-driven add/remove: pick one question set at a time from the
  // dropdown and add it to the list; each added set shows as a chip with a
  // remove (×) button.
  const [pendingSectionId, setPendingSectionId] = useState("");

  function addTestSection() {
    if (!pendingSectionId || testForm.sectionIds.includes(pendingSectionId)) return;
    setTestSections([...testForm.sectionIds, pendingSectionId]);
    setPendingSectionId("");
  }

  function removeTestSection(id) {
    setTestSections(testForm.sectionIds.filter((x) => x !== id));
  }

  const selectedSections = sectionExams.filter((ex) => testForm.sectionIds.includes(ex._id));
  const testTotalDuration = selectedSections.reduce((sum, ex) => sum + (ex.durationMinutes || 0), 0);
  const testTotalQuestions = selectedSections.reduce((sum, ex) => sum + (ex.totalQuestionsTarget || 0), 0);

  function handleTestSubmit(e) {
    e.preventDefault();
    if (testForm.sectionIds.length === 0) {
      alert("Add at least one question set to this test.");
      return;
    }
    const payload = {
      title: testForm.name.trim(),
      active: testForm.status === "Active",
      sectionIds: testForm.sectionIds,
      examDate: testForm.examDate || undefined,
      startTime: toISTISOString(testForm.startTime) || undefined,
      endTime: toISTISOString(testForm.endTime) || undefined,
      loginWindowMinutes: Number(testForm.loginWindowMinutes) || 5,
      instructions: testForm.instructions.trim() || undefined
    };
    const req = editingTestId ? ExamAPI.adminUpdateExam(editingTestId, payload) : ExamAPI.adminCreateExam(payload);
    req
      .then(() => {
        setEditingTestId(null);
        setTestForm(EMPTY_TEST_FORM);
        onExamsChanged();
      })
      .catch((err) => alert(err.message || (editingTestId ? "Could not update test." : "Could not create test.")));
  }

  // ---- Question bank form ----
  const [qForm, setQForm] = useState(EMPTY_QUESTION_FORM);
  const [editingId, setEditingId] = useState(null);
  const [successMsg, setSuccessMsg] = useState("");

  function startEdit(q) {
    setEditingId(q._id);
    setQForm({
      category: q.category, text: q.text,
      optA: q.options[0], optB: q.options[1], optC: q.options[2], optD: q.options[3],
      correct: String(q.correctOption)
    });
    window.scrollTo({ top: document.getElementById("qBankFormAnchor")?.offsetTop - 100 || 0, behavior: "smooth" });
  }

  function handleQuestionSubmit(e) {
    e.preventDefault();
    const payload = {
      category: qForm.category,
      text: qForm.text.trim(),
      options: [qForm.optA, qForm.optB, qForm.optC, qForm.optD],
      correctOption: parseInt(qForm.correct, 10)
    };
    const req = editingId ? ExamAPI.adminUpdateQuestion(editingId, payload) : ExamAPI.adminCreateQuestion(payload);
    req
      .then(() => {
        setSuccessMsg(editingId ? "Question updated successfully!" : "Question added successfully!");
        setTimeout(() => setSuccessMsg(""), 2000);
        setEditingId(null);
        setQForm(EMPTY_QUESTION_FORM);
        onQuestionsChanged();
      })
      .catch((err) => alert(err.message || "Could not save question."));
  }

  function handleQuestionDelete(id) {
    ExamAPI.adminDeleteQuestion(id).then(onQuestionsChanged).catch((err) => alert(err.message || "Could not delete question."));
  }

  // ---- Question bank Excel (.csv) export / import ----
  // Download: current bank (Category, Question Text, Option A-D, Correct
  // Option) as an Excel-openable .csv. Admin edits it in Excel — adding new
  // rows below the existing ones — and uploads the same file back; the new
  // rows get added to the database exactly like using the form above, and
  // then show up in the Question Bank list below.
  const csvInputRef = useRef(null);
  const [importMsg, setImportMsg] = useState("");

  function handleDownloadCSV() {
    downloadQuestionsCSV(questions);
  }

  function handleImportClick() {
    csvInputRef.current?.click();
  }

  function handleCSVFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const { questions: parsed, skipped } = parseQuestionsCSV(String(reader.result || ""));
      if (parsed.length === 0) {
        alert(skipped > 0
          ? `Could not import — all ${skipped} row(s) were missing a category, question text, an option, or a valid Correct Option (A/B/C/D).`
          : "No question rows found in that file.");
        return;
      }
      ExamAPI.adminBulkCreateQuestions(parsed)
        .then((res) => {
          const inserted = res?.inserted ?? parsed.length;
          const duplicates = parsed.length - inserted;
          const parts = [`${inserted} question(s) added`];
          if (duplicates > 0) parts.push(`${duplicates} duplicate question text(s) skipped`);
          if (skipped > 0) parts.push(`${skipped} row(s) skipped (missing/invalid data)`);
          setImportMsg(parts.join(" · "));
          setTimeout(() => setImportMsg(""), 5000);
          onQuestionsChanged();
        })
        .catch((err) => alert(err.message || "Could not import questions from file."));
    };
    reader.readAsText(file);
    e.target.value = ""; // allow re-selecting the same file next time
  }

  // Category options: configured exam names + any categories already used in
  // the bank, deduped case-insensitively (Apti vs apti collapse to one).
  const categoryMap = new Map();
  sectionExams.forEach((ex) => {
    const key = ex.title.trim().toLowerCase();
    if (!categoryMap.has(key)) categoryMap.set(key, ex.title.trim());
  });
  questions.forEach((q) => {
    const key = (q.category || "").trim().toLowerCase();
    if (key && !categoryMap.has(key)) categoryMap.set(key, q.category.trim());
  });
  const categoryOptions = [...categoryMap.values()];

  function countForCategory(category) {
    return questions.filter((q) => q.category.toLowerCase() === category.toLowerCase()).length;
  }

  // Group the bank by question-set so the UI shows one compact set list
  // (right side) instead of one giant flat table of every question at once —
  // clicking a set reveals just its own questions.
  const questionsByCategory = new Map();
  categoryOptions.forEach((c) => questionsByCategory.set(c, []));
  questions.forEach((q) => {
    const match = categoryOptions.find((c) => c.toLowerCase() === (q.category || "").trim().toLowerCase());
    const key = match || q.category;
    if (!questionsByCategory.has(key)) questionsByCategory.set(key, []);
    questionsByCategory.get(key).push(q);
  });

  const [selectedCategory, setSelectedCategory] = useState(null);
  const activeCategory = selectedCategory && categoryOptions.includes(selectedCategory)
    ? selectedCategory
    : (categoryOptions[0] || null);

  // ---- Registrations (per-exam assignment tracking) ----
  const [openAssignmentsFor, setOpenAssignmentsFor] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);

  function toggleAssignments(examId) {
    if (openAssignmentsFor === examId) {
      setOpenAssignmentsFor(null);
      return;
    }
    setOpenAssignmentsFor(examId);
    setAssignmentsLoading(true);
    ExamAPI.adminGetExamAssignments(examId)
      .then(setAssignments)
      .catch((err) => alert(err.message || "Could not load registrations."))
      .finally(() => setAssignmentsLoading(false));
  }

  const STATUS_CLASS = {
    Registered: "attempted", InvitationSent: "attempted", NotStarted: "not-attempted",
    InProgress: "attempted", Completed: "pass"
  };

  return (
    <section className="page-section active">
      <div className="section-heading">Exam - Round 1</div>
      <div className="section-sub">Create and manage Round 1 exams available on the portal</div>

      <div className="card-box" id="examFormAnchor">
        <h6>{editingExamId ? "Edit Question Set" : "Question Set Name"}</h6>
        <div className="sub">Add a question-set (e.g. Aptitude, Reasoning, Verbal) — this is just a bank of questions, not something students register for directly. Combine one or more of these into a "Combined Test" below to schedule an actual exam session.</div>
        <form className="row g-3" onSubmit={handleExamSubmit}>
          <div className="col-md-4">
            <label className="form-label small fw-bold text-secondary">Question Set Name</label>
            <input type="text" className="form-control" placeholder="e.g. Aptitude, Reasoning" required
              value={examForm.examName} onChange={(e) => setExamForm({ ...examForm, examName: e.target.value })} />
          </div>
          <div className="col-md-2">
            <label className="form-label small fw-bold text-secondary">Duration (mins)</label>
            <input type="number" className="form-control" min="1" placeholder="30" required
              value={examForm.duration} onChange={(e) => setExamForm({ ...examForm, duration: e.target.value })} />
          </div>
          <div className="col-md-2">
            <label className="form-label small fw-bold text-secondary">Total Questions</label>
            <input type="number" className="form-control" min="1" placeholder="20" required
              value={examForm.totalQuestions} onChange={(e) => setExamForm({ ...examForm, totalQuestions: e.target.value })} />
          </div>
          <div className="col-md-2">
            <label className="form-label small fw-bold text-secondary">Status</label>
            <select className="form-select" value={examForm.status} onChange={(e) => setExamForm({ ...examForm, status: e.target.value })}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
          <div className="col-md-2 d-flex align-items-end gap-2">
            <button type="submit" className="btn btn-dark w-100 fw-bold">{editingExamId ? "Save Changes" : "+ Add Exam"}</button>
          </div>
          {editingExamId && (
            <div className="col-12">
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={cancelEditExam}>Cancel edit</button>
            </div>
          )}
        </form>
      </div>

      <div className="card-box" id="testBuilderAnchor">
        <h6>{editingTestId ? "Edit Test" : "Create Test"}</h6>
        <div className="sub">Pick existing question sets (e.g. Aptitude, Reasoning) to combine into one named test — duration and total questions are auto-summed from the sets you add.</div>
        {sectionExams.length === 0 ? (
          <div className="text-muted small">Create at least one question set above before building a test.</div>
        ) : (
          <form className="row g-3" onSubmit={handleTestSubmit}>
            <div className="col-md-6">
              <label className="form-label small fw-bold text-secondary">Test Name</label>
              <input type="text" className="form-control" placeholder="e.g. Final Exam 2026" required
                value={testForm.name} onChange={(e) => setTestForm({ ...testForm, name: e.target.value })} />
            </div>
            <div className="col-md-6">
              <label className="form-label small fw-bold text-secondary">Status</label>
              <select className="form-select" value={testForm.status} onChange={(e) => setTestForm({ ...testForm, status: e.target.value })}>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>

            <div className="col-md-9">
              <label className="form-label small fw-bold text-secondary">Add Question Set</label>
              <select className="form-select" value={pendingSectionId} onChange={(e) => setPendingSectionId(e.target.value)}>
                <option value="">Select a question set...</option>
                {sectionExams.filter((ex) => !testForm.sectionIds.includes(ex._id)).map((ex) => (
                  <option key={ex._id} value={ex._id}>{ex.title} ({ex.durationMinutes || 0}m, {ex.totalQuestionsTarget || 0}q)</option>
                ))}
              </select>
            </div>
            <div className="col-md-3 d-flex align-items-end">
              <button type="button" className="btn btn-outline-dark w-100 fw-bold" disabled={!pendingSectionId} onClick={addTestSection}>+ Add</button>
            </div>

            {selectedSections.length > 0 && (
              <div className="col-12">
                <div className="d-flex flex-wrap gap-2">
                  {selectedSections.map((ex) => (
                    <span key={ex._id} className="badge-pill attempted d-flex align-items-center gap-2" style={{ fontSize: "0.85rem" }}>
                      {ex.title} ({ex.durationMinutes || 0}m, {ex.totalQuestionsTarget || 0}q)
                      <button type="button" className="btn-close btn-close-white" style={{ fontSize: "0.6rem" }} aria-label="Remove" onClick={() => removeTestSection(ex._id)}></button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {selectedSections.length > 0 && (
              <div className="col-12">
                <div className="small text-muted">
                  Total duration: <span className="fw-bold text-dark">{testTotalDuration} mins</span> &nbsp;·&nbsp;
                  Total questions: <span className="fw-bold text-dark">{testTotalQuestions}</span>
                </div>
              </div>
            )}

            <div className="col-12"><hr className="my-1" /></div>
            <div className="col-12 small fw-bold text-uppercase text-secondary">Scheduled session (optional — leave blank for an always-open test)</div>

            <div className="col-md-3">
              <label className="form-label small fw-bold text-secondary">Exam Start</label>
              <DateTimePicker
                value={testForm.startTime}
                onChange={(startTime) => {
                  setTestForm((prev) => ({
                    ...prev,
                    startTime,
                    examDate: startTime ? startTime.slice(0, 10) : prev.examDate,
                    endTime: testTotalDuration ? computeEndTime(startTime, testTotalDuration) : prev.endTime
                  }));
                }} />
            </div>
            <div className="col-md-3">
              <label className="form-label small fw-bold text-secondary">
                Exam End <span className="text-muted fw-normal">(auto-calculated — edit if needed)</span>
              </label>
              <DateTimePicker
                value={testForm.endTime} onChange={(endTime) => setTestForm({ ...testForm, endTime })} />
            </div>
            <div className="col-md-6">
              <label className="form-label small fw-bold text-secondary">Login Window (mins before start)</label>
              <input type="number" className="form-control" min="1" placeholder="5"
                value={testForm.loginWindowMinutes} onChange={(e) => setTestForm({ ...testForm, loginWindowMinutes: e.target.value })} />
            </div>
            <div className="col-12">
              <label className="form-label small fw-bold text-secondary">Instructions (shown on registration page)</label>
              <textarea className="form-control" placeholder="Optional — e.g. bring a valid ID, arrive 15 minutes early, exam rules, etc." rows={4}
                value={testForm.instructions} onChange={(e) => setTestForm({ ...testForm, instructions: e.target.value })} />
            </div>

            <div className="col-12 d-flex gap-2 mt-2">
              <button type="submit" className="btn btn-dark fw-bold px-4">{editingTestId ? "Save Changes" : "+ Create Test"}</button>
              {editingTestId && (
                <button type="button" className="btn btn-outline-secondary" onClick={cancelEditTest}>Cancel</button>
              )}
            </div>
          </form>
        )}

        {testExams.length > 0 && (
          <div className="row g-3 mt-1">
            {testExams.map((t, idx) => {
              const theme = TEST_CARD_THEMES[idx % TEST_CARD_THEMES.length];
              const sections = sectionExams.filter((s) => (t.sectionIds || []).includes(s._id));
              return (
                <div className="col-md-6 col-lg-4" key={t._id}>
                  <div className="test-card" style={{ borderTop: `5px solid ${theme.accent}`, background: theme.bg }}>
                    <div className="d-flex justify-content-between align-items-start mb-2">
                      <span className="badge-pill" style={{ background: theme.accent, color: "#fff", letterSpacing: "0.04em" }}>
                        <i className="fa-solid fa-graduation-cap me-1"></i>MAIN EXAM
                      </span>
                      <span className={`badge-pill ${t.active ? "pass" : "fail"}`}>{t.active ? "Active" : "Inactive"}</span>
                    </div>

                    <div className="test-card-title" style={{ color: theme.dark }}>{t.title}</div>

                    <div className="d-flex flex-wrap gap-1 my-2">
                      {sections.length > 0 ? sections.map((s) => (
                        <span key={s._id} className="test-card-chip" style={{ background: theme.chipBg, color: theme.dark }}>{s.title}</span>
                      )) : <span className="text-muted small">No sections</span>}
                    </div>

                    <div className="d-flex gap-2 my-2">
                      <div className="test-card-stat" style={{ borderColor: theme.accent }}>
                        <div className="test-card-stat-value" style={{ color: theme.dark }}>{t.durationMinutes}</div>
                        <div className="test-card-stat-label">minutes</div>
                      </div>
                      <div className="test-card-stat" style={{ borderColor: theme.accent }}>
                        <div className="test-card-stat-value" style={{ color: theme.dark }}>{t.totalQuestionsTarget}</div>
                        <div className="test-card-stat-label">questions</div>
                      </div>
                    </div>

                    <div className="test-card-schedule">
                      {t.startTime ? (
                        <><i className="fa-solid fa-calendar-days me-2" style={{ color: theme.accent }}></i>{formatDate(t.startTime)}</>
                      ) : (
                        <span className="text-muted"><i className="fa-solid fa-calendar-xmark me-2"></i>Not scheduled</span>
                      )}
                    </div>

                    <div className="d-flex flex-wrap gap-2 mt-3">
                      {t.startTime && (
                        <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => copyRegistrationLink(t._id)}>
                          <i className="fa-solid fa-link me-1"></i>Copy link
                        </button>
                      )}
                      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => toggleAssignments(t._id)}>
                        <i className="fa-solid fa-users me-1"></i>{openAssignmentsFor === t._id ? "Hide" : "View"} registrations
                      </button>
                      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => handleExamToggleActive(t)}>
                        {t.active ? "Deactivate" : "Activate"}
                      </button>
                      <button type="button" className="btn-edit" onClick={() => startEditTest(t)}>Edit</button>
                      <button type="button" className="btn-clear" onClick={() => handleExamDelete(t._id)}>Delete</button>
                    </div>

                    {openAssignmentsFor === t._id && (
                      <div className="mt-3 pt-2 border-top">
                        {assignmentsLoading ? (
                          <span className="text-muted small">Loading registrations...</span>
                        ) : assignments.length === 0 ? (
                          <span className="text-muted small">No students have registered for this test yet.</span>
                        ) : (
                          <div className="table-responsive">
                            <table className="table table-sm mb-0">
                              <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Status</th><th>Invitation Sent</th><th>Started</th><th>Completed</th></tr></thead>
                              <tbody>
                                {assignments.map((a) => (
                                  <tr key={a._id}>
                                    <td>{a.student?.fullName}</td>
                                    <td>{a.student?.email}</td>
                                    <td>{a.student?.phone}</td>
                                    <td><span className={`badge-pill ${STATUS_CLASS[a.status] || "attempted"}`}>{a.status}</span></td>
                                    <td className="small">{a.invitationSentAt ? formatDate(a.invitationSentAt) : "-"}</td>
                                    <td className="small">{a.startedAt ? formatDate(a.startedAt) : "-"}</td>
                                    <td className="small">{a.completedAt ? formatDate(a.completedAt) : "-"}</td>
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

      <div className="card-box">
        <h6>Existing Exam Set</h6>
        <div className="sub">Question-set sections only. To schedule an actual exam session with a registration link, combine sections into a "Combined Test" above.</div>
        {sectionExams.length === 0 ? (
          <div className="empty-state"><div className="emoji">📝</div><div>No exams created yet.</div></div>
        ) : (
          <div className="table-responsive">
            <table className="table candidates-table mb-0 align-middle">
              <thead><tr><th>Question Set Name</th><th>Duration</th><th>Total Questions</th><th>Status</th><th>Created On</th><th></th></tr></thead>
              <tbody>
                {sectionExams.slice().reverse().map((ex) => {
                  const actual = countForCategory(ex.title);
                  const target = ex.totalQuestionsTarget || 0;
                  const atTarget = target > 0 && actual >= target;
                  const underTarget = target > 0 && actual < target;
                  return (
                    <tr key={ex._id}>
                      <td className="name-cell">{ex.title}</td>
                      <td>{ex.durationMinutes} mins</td>
                      <td>
                        <span className={`fw-bold ${atTarget ? "text-success" : underTarget ? "text-warning" : ""}`}>
                          {actual}{target > 0 ? ` / ${target}` : ""}
                        </span>
                        {underTarget && <div className="small text-muted">{target - actual} more needed</div>}
                      </td>
                      <td>
                        <span className={`badge-pill ${ex.active ? "pass" : "fail"}`}>{ex.active ? "Active" : "Inactive"}</span>
                        <div className="mt-1">
                          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => handleExamToggleActive(ex)}>
                            {ex.active ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                      </td>
                      <td>{formatDate(ex.createdAt)}</td>
                      <td>
                        <button type="button" className="btn-edit mb-1 me-1" onClick={() => startEditExam(ex)}>Edit</button>
                        <button type="button" className="btn btn-sm btn-outline-primary mb-1 me-1" onClick={() => goAddQuestionFor(ex.title)}>+ Add Question</button>
                        <button type="button" className="btn-clear" onClick={() => handleExamDelete(ex._id)}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <h6 className="fw-bold mt-4" style={{ color: "var(--brand-dark)" }} id="qBankFormAnchor">Question Bank Management</h6>
      <div className="section-sub mb-3">Add and manage MCQ questions. These sync directly to the candidate's dashboard exam.</div>

      <div className="card-box mb-4">
        <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
          <h6 className="fw-bold mb-0" style={{ color: "var(--brand-dark)" }}>{editingId ? "Edit MCQ" : "Add MCQ to Database"}</h6>
          <div className="d-flex align-items-center gap-2">
            <button type="button" className="btn btn-sm btn-outline-dark" onClick={handleDownloadCSV}>
              <i className="fa-solid fa-file-arrow-down me-1"></i>Download Excel
            </button>
            <button type="button" className="btn btn-sm btn-outline-dark" onClick={handleImportClick}>
              <i className="fa-solid fa-file-arrow-up me-1"></i>Upload Excel
            </button>
            <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="d-none" onChange={handleCSVFileSelected} />
          </div>
        </div>
        <div className="form-text mb-2">
          Download the bank as an Excel sheet (.csv — opens directly in Excel/Google Sheets), add new rows in the same columns, save, then Upload the same file — the new questions get added here just like using the form below.
        </div>
        {importMsg && <div className="text-success small fw-bold mb-2">{importMsg}</div>}
        <form className="row g-3 mt-1" onSubmit={handleQuestionSubmit}>
          <div className="col-md-3">
            <label className="form-label small fw-bold text-secondary">Category</label>
            <select className="form-select" required
              value={qForm.category} onChange={(e) => setQForm({ ...qForm, category: e.target.value })}>
              <option value="" disabled>Select an exam...</option>
              {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {categoryOptions.length === 0 && (
              <div className="form-text text-warning">No exams created yet — add one under "Question Set Name" above first.</div>
            )}
          </div>
          <div className="col-md-9">
            <label className="form-label small fw-bold text-secondary">Question Text</label>
            <input type="text" className="form-control" placeholder="Question statement..." required
              value={qForm.text} onChange={(e) => setQForm({ ...qForm, text: e.target.value })} />
          </div>
          <div className="col-md-6"><input type="text" className="form-control" placeholder="Option A" required value={qForm.optA} onChange={(e) => setQForm({ ...qForm, optA: e.target.value })} /></div>
          <div className="col-md-6"><input type="text" className="form-control" placeholder="Option B" required value={qForm.optB} onChange={(e) => setQForm({ ...qForm, optB: e.target.value })} /></div>
          <div className="col-md-6"><input type="text" className="form-control" placeholder="Option C" required value={qForm.optC} onChange={(e) => setQForm({ ...qForm, optC: e.target.value })} /></div>
          <div className="col-md-6"><input type="text" className="form-control" placeholder="Option D" required value={qForm.optD} onChange={(e) => setQForm({ ...qForm, optD: e.target.value })} /></div>
          <div className="col-md-4">
            <label className="form-label small fw-bold text-secondary">Correct Option</label>
            <select className="form-select" value={qForm.correct} onChange={(e) => setQForm({ ...qForm, correct: e.target.value })}>
              <option value="0">Option A</option><option value="1">Option B</option>
              <option value="2">Option C</option><option value="3">Option D</option>
            </select>
          </div>
          <div className="col-md-8 d-flex flex-column align-items-end justify-content-end">
            <button type="submit" className="btn btn-dark w-100 fw-bold">{editingId ? "Update Question" : "+ Add Question"}</button>
            {successMsg && <div className="text-success small fw-bold mt-2">{successMsg}</div>}
          </div>
          {editingId && (
            <div className="col-12">
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { setEditingId(null); setQForm(EMPTY_QUESTION_FORM); }}>Cancel edit</button>
            </div>
          )}
        </form>
      </div>

      <div className="card-box">
        <div className="d-flex align-items-center gap-2 mb-3 border-bottom pb-2">
          <i className="fa-solid fa-layer-group" style={{ color: "var(--brand-dark)" }}></i>
          <h6 className="fw-bold mb-0" style={{ color: "var(--brand-dark)" }}>Question Bank</h6>
        </div>
        {questions.length === 0 ? (
          <div className="empty-state"><div className="emoji">📝</div><div>No questions in the bank yet.</div></div>
        ) : (
          <div className="row g-4">
            <div className="col-md-4 order-1">
              <div className="qbank-set-heading">Question Sets</div>
              <div className="qbank-set-list">
                {categoryOptions.map((c, idx) => {
                  const count = (questionsByCategory.get(c) || []).length;
                  const isActive = c === activeCategory;
                  const theme = TEST_CARD_THEMES[idx % TEST_CARD_THEMES.length];
                  return (
                    <button
                      key={c}
                      type="button"
                      className={`qbank-set-item${isActive ? " active" : ""}`}
                      style={{
                        borderLeftColor: theme.accent,
                        background: isActive ? theme.accent : "#fff"
                      }}
                      onClick={() => setSelectedCategory(c)}
                    >
                      <span className="qbank-set-icon" style={{ background: isActive ? "rgba(255,255,255,0.25)" : theme.chipBg, color: isActive ? "#fff" : theme.dark }}>
                        <i className="fa-solid fa-folder"></i>
                      </span>
                      <span className="qbank-set-name">{c}</span>
                      <span className="qbank-set-count" style={{ background: isActive ? "rgba(255,255,255,0.25)" : theme.chipBg, color: isActive ? "#fff" : theme.dark }}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="col-md-8 order-2">
              {activeCategory ? (
                <>
                  <div className="d-flex align-items-center justify-content-between mb-3">
                    <div className="d-flex align-items-center gap-2">
                      <span className="qbank-active-badge">
                        <i className="fa-solid fa-folder-open me-2"></i>{activeCategory}
                      </span>
                      <span className="text-muted small">{(questionsByCategory.get(activeCategory) || []).length} question(s)</span>
                    </div>
                  </div>
                  {(questionsByCategory.get(activeCategory) || []).length === 0 ? (
                    <div className="empty-state"><div className="emoji">🗂️</div><div>No questions in this set yet.</div></div>
                  ) : (
                    <div className="table-responsive">
                      <table className="table candidates-table mb-0 align-middle">
                        <thead><tr><th>Question</th><th>Options</th><th>Correct Ans</th><th>Action</th></tr></thead>
                        <tbody>
                          {(questionsByCategory.get(activeCategory) || []).map((q) => (
                            <tr key={q._id}>
                              <td style={{ fontSize: "0.85rem" }}>{q.text}</td>
                              <td className="small text-muted">A: {q.options[0]}<br />B: {q.options[1]}<br />C: {q.options[2]}<br />D: {q.options[3]}</td>
                              <td><span className="badge-pill attempted">{String.fromCharCode(65 + q.correctOption)}</span></td>
                              <td>
                                <button type="button" className="btn-edit mb-1 me-1" onClick={() => startEdit(q)}>Edit</button>
                                <button type="button" className="btn-clear" onClick={() => handleQuestionDelete(q._id)}>Delete</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : (
                <div className="empty-state"><div className="emoji">👉</div><div>Select a question set to view its questions.</div></div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}