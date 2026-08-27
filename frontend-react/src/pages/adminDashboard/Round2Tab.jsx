import { useState } from "react";
import ExamAPI from "../../api";
import { formatDate } from "./analytics";

const EMPTY_CQ_FORM = {
  title: "", difficulty: "Medium", description: "", correctOutput: "",
  ex1In: "", ex1Out: "", ex2In: "", ex2Out: "", ex3In: "", ex3Out: ""
};

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
  // ---- Second-level exam config form ----
  const [examForm, setExamForm] = useState({ examName: "", duration: "", testCases: "", difficulty: "Medium" });

  function handleExamSubmit(e) {
    e.preventDefault();
    ExamAPI.adminCreateSecondLevelExam({ title: examForm.examName.trim(), durationMinutes: Number(examForm.duration) })
      .then(() => {
        setExamForm({ examName: "", duration: "", testCases: "", difficulty: "Medium" });
        onSecondExamsChanged();
      })
      .catch((err) => alert(err.message || "Could not create Round 2 exam config."));
  }

  function handleExamDelete(id) {
    ExamAPI.adminDeleteSecondLevelExam(id).then(onSecondExamsChanged).catch((err) => alert(err.message || "Could not delete."));
  }

  // ---- Coding question form ----
  const [cqForm, setCqForm] = useState(EMPTY_CQ_FORM);
  const [editingId, setEditingId] = useState(null);

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
              value={examForm.duration} onChange={(e) => setExamForm({ ...examForm, duration: e.target.value })} />
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
          </div>
          <div className="col-md-2 d-flex align-items-end">
            <button type="submit" className="btn btn-dark w-100 fw-bold">+ Add Config</button>
          </div>
        </form>
      </div>

      <div className="card-box">
        <h6>Round 2 Configured Exams</h6>
        <div className="sub">Test-cases based exams configured for the second round.</div>
        {secondExams.length === 0 ? (
          <div className="empty-state"><div className="emoji">🎯</div><div>No second level configs created yet.</div></div>
        ) : (
          <div className="table-responsive">
            <table className="table candidates-table mb-0 align-middle">
              <thead><tr><th>Exam Name</th><th>Duration</th><th>Created On</th><th></th></tr></thead>
              <tbody>
                {secondExams.slice().reverse().map((ex) => (
                  <tr key={ex._id}>
                    <td className="name-cell">{ex.title}</td>
                    <td>{ex.durationMinutes} mins</td>
                    <td>{formatDate(ex.createdAt)}</td>
                    <td><button type="button" className="btn-clear" onClick={() => handleExamDelete(ex._id)}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card-box mt-4 border-top border-4 border-primary" id="codingQFormAnchor">
        <h6 className="fw-bold text-primary">{editingId ? "Edit Coding Problem" : "Manage Round 2 Coding Questions"}</h6>
        <div className="sub">Add algorithmic problems. These sync directly to the candidate's Round 2 dashboard. Exactly 3 examples are required.</div>

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
        <h6 className="fw-bold text-secondary border-bottom pb-2">Round 2 Question Bank</h6>
        <div className="table-responsive">
          <table className="table candidates-table mb-0 align-middle">
            <thead><tr><th>Title</th><th>Difficulty</th><th>Correct Output</th><th>Examples (3 Required)</th><th style={{ minWidth: 140 }}>Action</th></tr></thead>
            <tbody>
              {codingQuestions.length === 0 ? (
                <tr><td colSpan={5} className="text-center text-muted py-3">No coding questions added.</td></tr>
              ) : (
                codingQuestions.slice().reverse().map((q) => {
                  const ex = q.examples || [];
                  return (
                    <tr key={q._id}>
                      <td className="fw-bold text-dark" style={{ maxWidth: 200 }}>{q.title}</td>
                      <td><span className="badge-pill attempted">{q.difficulty}</span></td>
                      <td><code>{q.correctOutput || q.funcName}</code></td>
                      <td className="small text-muted" style={{ lineHeight: 1.6 }}>
                        <div><span className="fw-bold">Ex1:</span> In: {ex[0]?.input ?? "N/A"} | Out: {ex[0]?.output ?? "N/A"}</div>
                        <div><span className="fw-bold">Ex2:</span> In: {ex[1]?.input ?? "N/A"} | Out: {ex[1]?.output ?? "N/A"}</div>
                        <div><span className="fw-bold">Ex3:</span> In: {ex[2]?.input ?? "N/A"} | Out: {ex[2]?.output ?? "N/A"}</div>
                      </td>
                      <td>
                        <button className="btn-edit me-1" onClick={() => startEdit(q)}>Edit</button>
                        <button className="btn-clear" onClick={() => handleCqDelete(q._id)}>Delete</button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
