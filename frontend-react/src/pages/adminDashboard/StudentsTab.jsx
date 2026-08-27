import ExamAPI from "../../api";
import { createPdfDoc, pdfTitle, pdfTable } from "./pdf";
import { formatDate } from "./analytics";

export default function StudentsTab({ students, onDataChanged }) {
  function handleClearData() {
    if (!window.confirm("Are you sure you want to clear all student details and candidate result data? This cannot be undone.")) return;
    Promise.all([ExamAPI.adminClearStudents(), ExamAPI.adminClearSubmissions(), ExamAPI.adminClearSecondLevelResults()])
      .then(onDataChanged)
      .catch((err) => alert(err.message || "Could not clear data on the server."));
  }

  function handleDownloadPdf() {
    const doc = createPdfDoc();
    pdfTitle(doc, "Registered Students", "Details submitted on the candidate login page — generated " + new Date().toLocaleString());
    pdfTable(doc, ["#", "Full Name", "Email Address", "Phone Number"], students.map((s, i) => [i + 1, s.fullName, s.email, s.phone]));
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
              <thead><tr><th>#</th><th>Full Name</th><th>Email Address</th><th>Phone Number</th><th>Registered</th></tr></thead>
              <tbody>
                {students.map((s, i) => (
                  <tr key={s._id}>
                    <td>{i + 1}</td>
                    <td className="name-cell">{s.fullName}</td>
                    <td>{s.email}</td>
                    <td>{s.phone}</td>
                    <td className="small text-muted">{formatDate(s.registeredAt)}</td>
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
