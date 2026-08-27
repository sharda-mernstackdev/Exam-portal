import { useMemo, useState } from "react";
import { createPdfDoc, pdfTitle, pdfTable } from "./pdf";
import { formatDate } from "./analytics";

const FILTERS = [
  { key: "all", label: "All Candidates" },
  { key: "r1_passed", label: "Round 1 Passed" },
  { key: "r1_failed", label: "Round 1 Failed" },
  { key: "r2_eligible", label: "Round 2 Eligible" },
  { key: "r2_completed", label: "Round 2 Completed" },
  { key: "r2_passed", label: "Round 2 Passed" },
  { key: "r2_failed", label: "Round 2 Failed" },
  { key: "cleared_both", label: "Cleared Both Rounds" }
];

const FINAL_STATUS_LABEL = {
  PENDING: "Pending",
  FAILED_ROUND1: "Failed Round 1",
  ROUND2_PENDING: "Round 2 Pending",
  FAILED_ROUND2: "Failed Round 2",
  CLEARED_BOTH: "Cleared Both Rounds"
};

function StatusBadge({ status }) {
  const map = {
    PASS: { cls: "pass", text: "PASSED" },
    FAIL: { cls: "fail", text: "FAILED" },
    PENDING: { cls: "attempted", text: "PENDING" }
  };
  const m = map[status] || { cls: "attempted", text: status || "-" };
  return <span className={`badge-pill ${m.cls}`}>{m.text}</span>;
}

function matchesFilter(row, filter) {
  switch (filter) {
    case "r1_passed": return row.round1 && row.round1.status === "PASS";
    case "r1_failed": return row.round1 && row.round1.status === "FAIL";
    case "r2_eligible": return row.round2Eligible;
    case "r2_completed": return row.round2Completed;
    case "r2_passed": return row.round2 && row.round2.status === "PASS";
    case "r2_failed": return row.round2 && row.round2.status === "FAIL";
    case "cleared_both": return row.finalStatus === "CLEARED_BOTH";
    default: return true;
  }
}

export default function ResultsReportTab({ journey, qualifyingPct }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return journey
      .filter((row) => matchesFilter(row, filter))
      .filter((row) => !q || row.name.toLowerCase().includes(q) || row.email.toLowerCase().includes(q));
  }, [journey, filter, search]);

  const counts = useMemo(() => {
    const c = { r1Passed: 0, r1Failed: 0, r2Passed: 0, r2Failed: 0, clearedBoth: 0 };
    journey.forEach((r) => {
      if (r.round1?.status === "PASS") c.r1Passed++;
      if (r.round1?.status === "FAIL") c.r1Failed++;
      if (r.round2?.status === "PASS") c.r2Passed++;
      if (r.round2?.status === "FAIL") c.r2Failed++;
      if (r.finalStatus === "CLEARED_BOTH") c.clearedBoth++;
    });
    return c;
  }, [journey]);

  function downloadJourneyPdf() {
    const doc = createPdfDoc();
    pdfTitle(doc, "Candidate Journey Report", `${FILTERS.find((f) => f.key === filter)?.label || "All Candidates"} — generated ${new Date().toLocaleString()}`);
    pdfTable(
      doc,
      ["Candidate", "Email", "R1 %", "R1 Status", "R2 Eligible", "R2 %", "R2 Status", "Final Status"],
      filtered.length
        ? filtered.map((r) => [
            r.name, r.email,
            r.round1 ? r.round1.percentage + "%" : "-", r.round1 ? r.round1.status : "-",
            r.round2Eligible ? "Yes" : "No",
            r.round2 ? r.round2.score : "-", r.round2 ? r.round2.status : "-",
            FINAL_STATUS_LABEL[r.finalStatus] || r.finalStatus
          ])
        : [["No candidates match this filter", "-", "-", "-", "-", "-", "-", "-"]]
    );
    doc.save("candidate-journey-report.pdf");
  }

  return (
    <section className="page-section active">
      <div className="section-heading">Results Report</div>
      <div className="section-sub">Complete two-round candidate journey — Round 1 result, Round 2 eligibility, and final status</div>

      <div className="alert bg-white border shadow-sm d-flex justify-content-between align-items-center flex-wrap gap-2 mb-4 p-3 rounded-3">
        <div className="d-flex align-items-center gap-3">
          <div className="p-2 bg-dark text-white rounded-2"><i className="fa-solid fa-calculator fs-5"></i></div>
          <div>
            <h6 className="fw-bold mb-0">Evaluation Rule & Pass Criteria</h6>
            <span className="small text-muted">Qualifying Threshold: <strong className="text-primary">&ge; {qualifyingPct}% Score</strong></span>
          </div>
        </div>
        <div className="d-flex gap-2 flex-wrap">
          <span className="badge bg-success-subtle text-success border border-success px-3 py-2 fw-bold">R1 Passed: {counts.r1Passed}</span>
          <span className="badge bg-danger-subtle text-danger border border-danger px-3 py-2 fw-bold">R1 Failed: {counts.r1Failed}</span>
          <span className="badge bg-success-subtle text-success border border-success px-3 py-2 fw-bold">R2 Passed: {counts.r2Passed}</span>
          <span className="badge bg-danger-subtle text-danger border border-danger px-3 py-2 fw-bold">R2 Failed: {counts.r2Failed}</span>
          <span className="badge bg-primary-subtle text-primary border border-primary px-3 py-2 fw-bold">Cleared Both: {counts.clearedBoth}</span>
        </div>
      </div>

      <div className="card-box">
        <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
          <div>
            <h6>Candidate Journey <span className="badge-pill attempted">{filtered.length}</span></h6>
            <div className="sub mb-0">Round 1 result, Round 2 eligibility/status, and combined final outcome per candidate</div>
          </div>
          <button className="btn btn-sm btn-dark fw-bold" onClick={downloadJourneyPdf}>
            <i className="fa-solid fa-file-pdf me-1"></i> Download PDF
          </button>
        </div>

        <div className="d-flex flex-wrap gap-2 mb-3">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`btn btn-sm ${filter === f.key ? "btn-dark" : "btn-outline-secondary"}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
          <input
            type="text"
            className="form-control form-control-sm ms-auto"
            style={{ maxWidth: 240 }}
            placeholder="Search name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state"><div className="emoji">📭</div><div>No candidates match this filter.</div></div>
        ) : (
          <div className="table-responsive">
            <table className="table candidates-table mb-0 align-middle">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>R1 Score</th>
                  <th>R1 %</th>
                  <th>R1 Status</th>
                  <th>R2 Eligible</th>
                  <th>R2 Score</th>
                  <th>R2 Status</th>
                  <th>Final Status</th>
                  <th>Submitted On</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.studentId}>
                    <td>
                      <div className="name-cell">{r.name}</div>
                      <div className="small text-muted">{r.email}</div>
                    </td>
                    <td>{r.round1 ? `${r.round1.score} / ${r.round1.total}` : "-"}</td>
                    <td className="fw-bold">{r.round1 ? r.round1.percentage + "%" : "-"}</td>
                    <td>{r.round1 ? <StatusBadge status={r.round1.status} /> : <span className="text-muted">-</span>}</td>
                    <td>
                      {r.round2Eligible ? (
                        <span className="badge-pill pass">ELIGIBLE</span>
                      ) : (
                        <span className="text-muted small">-</span>
                      )}
                      {r.round2EmailSent && <div className="small text-muted mt-1"><i className="fa-solid fa-envelope-circle-check me-1"></i>Email sent</div>}
                    </td>
                    <td className="fw-bold">{r.round2 ? r.round2.score : "-"}</td>
                    <td>{r.round2 ? <StatusBadge status={r.round2.status} /> : <span className="text-muted">-</span>}</td>
                    <td>
                      <span className={`badge-pill ${r.finalStatus === "CLEARED_BOTH" ? "pass" : r.finalStatus.includes("FAILED") ? "fail" : "attempted"}`}>
                        {FINAL_STATUS_LABEL[r.finalStatus] || r.finalStatus}
                      </span>
                      {r.finalEmailSent && <div className="small text-muted mt-1"><i className="fa-solid fa-envelope-circle-check me-1"></i>Final email sent</div>}
                    </td>
                    <td className="small text-muted">{r.round2?.submittedOn ? formatDate(r.round2.submittedOn) : r.round1?.submittedOn ? formatDate(r.round1.submittedOn) : "-"}</td>
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
