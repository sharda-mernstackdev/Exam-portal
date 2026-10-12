import ExamAPI from "../../api";
import { createPdfDoc, pdfTitle, pdfTable } from "./pdf";
import { formatDate } from "./analytics";

// "Registered" = the student has registered for a Round 1 exam (server sends
// round1Registered). Anyone else in the list is still "Pending".
function isRound1Registered(s) {
  return !!s.round1Registered;
}

export default function StudentsTab({ students, onDataChanged }) {
  const registeredCount = students.filter(isRound1Registered).length;
  const pendingCount = students.length - registeredCount;

  function handleClearData() {
    if (!window.confirm("Are you sure you want to clear all student details and candidate result data? This cannot be undone.")) return;
    Promise.all([ExamAPI.adminClearStudents(), ExamAPI.adminClearSubmissions(), ExamAPI.adminClearSecondLevelResults()])
      .then(onDataChanged)
      .catch((err) => alert(err.message || "Could not clear data on the server."));
  }

  function handleDownloadPdf() {
    const doc = createPdfDoc();
    pdfTitle(doc, "Registered Students", "Details submitted on the candidate login page — generated " + new Date().toLocaleString());
    pdfTable(doc, ["#", "Full Name", "Email Address", "Phone Number", "Round 1 Status"], students.map((s, i) => [i + 1, s.fullName, s.email, s.phone, isRound1Registered(s) ? "Registered for Round 1" : "Pending"]));
    doc.save("registered-students.pdf");
  }

  return (
    <section className="page-section active">
      <div className="section-heading">Students</div>
      <div className="section-sub">Details submitted by candidates on the login page</div>

      <div className="card-box">
        <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
          <div>
            <h6>Registered Students <span className="badge-pill attempted">{students.length}</span></h6>
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

        {students.length === 0 ? (
          <div className="empty-state"><div className="emoji">📭</div><div>No student details have been submitted yet.</div></div>
        ) : (
          <div className="table-responsive">
            <table className="table candidates-table mb-0 align-middle">
              <thead><tr><th>#</th><th>Full Name</th><th>Email Address</th><th>Phone Number</th><th>Registered</th><th>Round 1 Status</th></tr></thead>
              <tbody>
                {students.map((s, i) => (
                  <tr key={s._id}>
                    <td>{i + 1}</td>
                    <td className="name-cell">{s.fullName}</td>
                    <td>{s.email}</td>
                    <td>{s.phone}</td>
                    <td className="small text-muted">{formatDate(s.registeredAt)}</td>
                    <td>
                      {isRound1Registered(s) ? (
                        <span className="badge-pill pass"><i className="fa-solid fa-circle-check me-1"></i>Registered for Round 1</span>
                      ) : (
                        <span className="badge-pill" style={{ background: "#fef3c7", color: "#92400e" }}><i className="fa-regular fa-hourglass-half me-1"></i>Pending</span>
                      )}
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