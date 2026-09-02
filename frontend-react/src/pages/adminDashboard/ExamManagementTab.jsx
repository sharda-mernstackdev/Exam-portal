import { useState } from "react";
import ExamAPI from "../../api";
import { formatDate } from "./analytics";

const EMPTY_QUESTION_FORM = { category: "", text: "", optA: "", optB: "", optC: "", optD: "", correct: "0" };

export default function ExamManagementTab({ exams, questions, onExamsChanged, onQuestionsChanged }) {
  // ---- Exam create form ----
  const [examForm, setExamForm] = useState({ examName: "", duration: "", totalQuestions: "", status: "Active" });

  function handleExamSubmit(e) {
    e.preventDefault();
    ExamAPI.adminCreateExam({
      title: examForm.examName.trim(),
      durationMinutes: Number(examForm.duration),
      qualifyingPct: 70,
      totalQuestionsTarget: Number(examForm.totalQuestions) || 0,
      active: examForm.status === "Active"
    })
      .then(() => {
        setExamForm({ examName: "", duration: "", totalQuestions: "", status: "Active" });
        onExamsChanged();
      })
      .catch((err) => alert(err.message || "Could not create exam."));
  }

  function handleExamDelete(id) {
    ExamAPI.adminDeleteExam(id).then(onExamsChanged).catch((err) => alert(err.message || "Could not delete exam."));
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

  const categoryMap = new Map();
  exams.forEach((ex) => {
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

  return (
    <section className="page-section active">
      <div className="section-heading">Exam - Round 1</div>
      <div className="section-sub">Create and manage Round 1 exams available on the portal</div>

      <div className="card-box">
        <h6>Create New Exam</h6>
        <div className="sub">Add a new exam to the portal</div>
        <form className="row g-3" onSubmit={handleExamSubmit}>
          <div className="col-md-4">
            <label className="form-label small fw-bold text-secondary">Exam Name</label>
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
          <div className="col-md-2 d-flex align-items-end">
            <button type="submit" className="btn btn-dark w-100 fw-bold">+ Add Exam</button>
          </div>
        </form>
      </div>

      <div className="card-box">
        <h6>Existing Exams</h6>
        <div className="sub">All exams currently configured on the portal</div>
        {exams.length === 0 ? (
          <div className="empty-state"><div className="emoji">📝</div><div>No exams created yet.</div></div>
        ) : (
          <div className="table-responsive">
            <table className="table candidates-table mb-0 align-middle">
              <thead><tr><th>Exam Name</th><th>Duration</th><th>Total Questions</th><th>Status</th><th>Created On</th><th></th></tr></thead>
              <tbody>
                {exams.slice().reverse().map((ex) => {
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
                      <td><span className={`badge-pill ${ex.active ? "pass" : "fail"}`}>{ex.active ? "Active" : "Inactive"}</span></td>
                      <td>{formatDate(ex.createdAt)}</td>
                      <td><button type="button" className="btn-clear" onClick={() => handleExamDelete(ex._id)}>Delete</button></td>
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
        <h6 className="fw-bold" style={{ color: "var(--brand-dark)" }}>{editingId ? "Edit MCQ" : "Add MCQ to Database"}</h6>
        <form className="row g-3 mt-1" onSubmit={handleQuestionSubmit}>
          <div className="col-md-3">
            <label className="form-label small fw-bold text-secondary">Category</label>
            <select className="form-select" required
              value={qForm.category} onChange={(e) => setQForm({ ...qForm, category: e.target.value })}>
              <option value="" disabled>Select an exam...</option>
              {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {categoryOptions.length === 0 && (
              <div className="form-text text-warning">No exams created yet — add one under "Create New Exam" above first.</div>
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

      <div className="card-box table-responsive">
        <h6 className="fw-bold mb-3 border-bottom pb-2" style={{ color: "var(--brand-dark)" }}>Question Bank</h6>
        <table className="table candidates-table mb-0 align-middle">
          <thead><tr><th>Category</th><th>Question</th><th>Options</th><th>Correct Ans</th><th>Action</th></tr></thead>
          <tbody>
            {questions.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-4 text-muted">No questions in the bank yet.</td></tr>
            ) : (
              questions.map((q) => (
                <tr key={q._id}>
                  <td><span className="badge bg-dark text-white p-1 rounded small">{q.category}</span></td>
                  <td style={{ fontSize: "0.85rem" }}>{q.text}</td>
                  <td className="small text-muted">A: {q.options[0]}<br />B: {q.options[1]}<br />C: {q.options[2]}<br />D: {q.options[3]}</td>
                  <td><span className="badge-pill attempted">{String.fromCharCode(65 + q.correctOption)}</span></td>
                  <td>
                    <button type="button" className="btn-edit mb-1 me-1" onClick={() => startEdit(q)}>Edit</button>
                    <button type="button" className="btn-clear" onClick={() => handleQuestionDelete(q._id)}>Delete</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}