import { useMemo, useState } from "react";
import ExamAPI from "../../api";
import { createPdfDoc, pdfTitle, pdfTable } from "./pdf";
import { formatDate } from "./analytics";

// "Registered" = the student has registered for a Round 1 exam (server sends
// round1Registered). Anyone else in the list is still "Pending".
function isRound1Registered(s) {
  return !!s.round1Registered;
}

// How the candidate took / takes Round 1: "campus" = Offline (campus drive),
// "online" = Online exam, "" = not registered for any exam yet.
function modeOf(s) {
  if (s.entryMode === "campus") return "offline";
  if (s.entryMode === "online") return "online";
  return "";
}

function ModeBadge({ mode }) {
  if (mode === "offline") {
    return <span className="badge-pill" style={{ background: "#ccfbf1", color: "#0f766e" }}><i className="fa-solid fa-building-columns me-1"></i>Offline</span>;
  }
  if (mode === "online") {
    return <span className="badge-pill" style={{ background: "#e0e3ff", color: "#3730a3" }}><i className="fa-solid fa-laptop me-1"></i>Online</span>;
  }
  return <span className="text-muted small">-</span>;
}

const MODE_TABS = [
  { key: "all", label: "All", icon: "fa-users" },
  { key: "online", label: "Online", icon: "fa-laptop" },
  { key: "offline", label: "Offline", icon: "fa-building-columns" }
];

export default function StudentsTab({ students, onDataChanged }) {
  const [modeFilter, setModeFilter] = useState("all");
  const [search, setSearch] = useState("");

  const counts = useMemo(() => {
    const c = { all: students.length, online: 0, offline: 0 };
    students.forEach((s) => {
      const m = modeOf(s);
      if (m === "online") c.online++;
      if (m === "offline") c.offline++;
    });
    return c;
  }, [students]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students
      .filter((s) => modeFilter === "all" || modeOf(s) === modeFilter)
      .filter((s) => !q || (s.fullName || "").toLowerCase().includes(q) || (s.email || "").toLowerCase().includes(q) || String(s.phone || "").includes(q));
  }, [students, modeFilter, search]);

  const registeredCount = shown.filter(isRound1Registered).length;
  const pendingCount = shown.length - registeredCount;

  function handleClearData() {
    if (!window.confirm("Are you sure you want to clear all student details and candidate result data? This cannot be undone.")) return;
    Promise.all([ExamAPI.adminClearStudents(), ExamAPI.adminClearSubmissions(), ExamAPI.adminClearSecondLevelResults()])
      .then(onDataChanged)
      .catch((err) => alert(err.message || "Could not clear data on the server."));
  }

  function handleDeleteStudent(s) {
    if (!window.confirm(`Delete ${s.fullName} (${s.email})?\n\nTheir registration, exam results and logs will also be removed. This cannot be undone.`)) return;
    ExamAPI.adminDeleteStudent(s._id)
      .then(onDataChanged)
      .catch((err) => alert(err.message || "Could not delete this student."));
  }

  function handleDownloadPdf() {
    const label = MODE_TABS.find((t) => t.key === modeFilter)?.label || "All";
    const doc = createPdfDoc();
    pdfTitle(doc, "Registered Students — " + label, "Details submitted on the candidate login page — generated " + new Date().toLocaleString());
    pdfTable(
      doc,
      ["#", "Full Name", "Email Address", "Phone Number", "Mode", "Exam", "Round 1 Status"],
      shown.map((s, i) => [
        i + 1, s.fullName, s.email, s.phone,
        modeOf(s) === "offline" ? "Offline" : modeOf(s) === "online" ? "Online" : "-",
        s.examTitle || "-",
        isRound1Registered(s) ? "Registered for Round 1" : "Pending"
      ])
    );
    doc.save("registered-students.pdf");
  }

  return (
    <section className="page-section active">
      <div className="section-heading">Students</div>
      <div className="section-sub">Details submitted by candidates on the login page — Online and Offline candidates are shown separately</div>

      <div className="row g-3 mb-3">
        <div className="col-md-4">
          <div className="p-3 rounded-3 bg-white border shadow-sm h-100" style={{ borderLeft: "5px solid #4f46e5" }}>
            <div className="small text-muted fw-bold text-uppercase"><i className="fa-solid fa-laptop me-1"></i>Online candidates</div>
            <div className="fs-3 fw-bold" style={{ color: "#3730a3" }}>{counts.online}</div>
            <div className="small text-muted">Registered through the exam link</div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="p-3 rounded-3 bg-white border shadow-sm h-100" style={{ borderLeft: "5px solid #0d9488" }}>
            <div className="small text-muted fw-bold text-uppercase"><i className="fa-solid fa-building-columns me-1"></i>Offline candidates</div>
            <div className="fs-3 fw-bold" style={{ color: "#0f766e" }}>{counts.offline}</div>
            <div className="small text-muted">Entered at a campus drive address</div>
          </div>
        </div>
        <div className="col-md-4">
          <div className="p-3 rounded-3 bg-white border shadow-sm h-100" style={{ borderLeft: "5px solid #64748b" }}>
            <div className="small text-muted fw-bold text-uppercase"><i className="fa-solid fa-users me-1"></i>All students</div>
            <div className="fs-3 fw-bold text-dark">{counts.all}</div>
            <div className="small text-muted">Including those not yet registered for an exam</div>
          </div>
        </div>
      </div>

      <div className="card-box">
        <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
          <div>
            <h6>Registered Students <span className="badge-pill attempted">{shown.length}</span></h6>
            <div className="sub mb-0">Full Name, Email Address and Phone Number as entered at login</div>
            <div className="mt-2 d-flex gap-2 flex-wrap">
              <span className="badge-pill pass"><i className="fa-solid fa-circle-check me-1"></i>Registered for Round 1: {registeredCount}</span>
              <span className="badge-pill" style={{ background: "#fef3c7", color: "#92400e" }}><i className="fa-regular fa-hourglass-half me-1"></i>Pending: {pendingCount}</span>
            </div>
          </div>
          <div className="d-flex gap-2 flex-wrap">
            <button className="btn btn-sm btn-dark fw-bold" onClick={handleDownloadPdf}>
              <i className="fa-solid fa-file-pdf me-1"></i> Download PDF
            </button>
            <button className="btn-clear" onClick={handleClearData}><i className="fa-solid fa-trash me-1"></i> Clear All Data</button>
          </div>
        </div>

        <div className="d-flex flex-wrap gap-2 mb-3 align-items-center">
          {MODE_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`btn btn-sm fw-bold ${modeFilter === t.key ? "btn-dark" : "btn-outline-secondary"}`}
              onClick={() => setModeFilter(t.key)}
            >
              <i className={`fa-solid ${t.icon} me-1`}></i>{t.label} ({counts[t.key]})
            </button>
          ))}
          <input
            type="text"
            className="form-control form-control-sm ms-auto"
            style={{ maxWidth: 240 }}
            placeholder="Search name, email or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {shown.length === 0 ? (
          <div className="empty-state"><div className="emoji">📭</div><div>{students.length === 0 ? "No student details have been submitted yet." : "No students match this filter."}</div></div>
        ) : (
          <div className="table-responsive">
            <table className="table candidates-table mb-0 align-middle">
              <thead><tr><th>#</th><th>Full Name</th><th>Email Address</th><th>Phone Number</th><th>Mode</th><th>Exam</th><th>Registered</th><th>Round 1 Status</th><th>Action</th></tr></thead>
              <tbody>
                {shown.map((s, i) => (
                  <tr key={s._id}>
                    <td>{i + 1}</td>
                    <td className="name-cell">{s.fullName}</td>
                    <td>{s.email}</td>
                    <td>{s.phone}</td>
                    <td><ModeBadge mode={modeOf(s)} /></td>
                    <td className="small">{s.examTitle || <span className="text-muted">-</span>}</td>
                    <td className="small text-muted">{formatDate(s.registeredAt)}</td>
                    <td>
                      {isRound1Registered(s) ? (
                        <span className="badge-pill pass"><i className="fa-solid fa-circle-check me-1"></i>Registered for Round 1</span>
                      ) : (
                        <span className="badge-pill" style={{ background: "#fef3c7", color: "#92400e" }}><i className="fa-regular fa-hourglass-half me-1"></i>Pending</span>
                      )}
                    </td>
                    <td>
                      <button type="button" className="btn-clear" onClick={() => handleDeleteStudent(s)} title="Delete this student">
                        <i className="fa-solid fa-trash me-1"></i>Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}