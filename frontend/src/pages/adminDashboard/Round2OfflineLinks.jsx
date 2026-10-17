import { useEffect, useState } from "react";
import ExamAPI from "../../api";

const FRONTEND_URL = window.location.origin;

// Round 2 addresses of the OFFLINE exams (www.site.com/<exam>/round-2) and the
// Round 2 access code. Shown on the Round 2 page so the admin can give them to
// the students who passed Round 1 (the Round 2 mail has no link or code).
export default function Round2OfflineLinks() {
  const [exams, setExams] = useState([]);
  const [code, setCode] = useState("");

  useEffect(() => {
    ExamAPI.adminGetExams()
      .then((list) => setExams((list || []).filter((e) => e.examMode === "campus" && e.slug)))
      .catch(() => { /* nothing to show */ });
    ExamAPI.adminGetSettings()
      .then((s) => setCode((s && s.round2AccessCode) || ""))
      .catch(() => { /* nothing to show */ });
  }, []);

  if (exams.length === 0) return null;

  function copy(text, label) {
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => alert(label + " copied."));
  }

  return (
    <div className="card-box">
      <h6><i className="fa-solid fa-link me-2"></i>Offline exams — Round 2 address</h6>
      <div className="sub">
        Give the address below and the Round 2 access code to the students who passed Round 1. They enter their email and the code, and Round 2 starts.
      </div>
      <div className="mb-2 small">
        Round 2 access code:{" "}
        {code ? <b style={{ letterSpacing: 2 }}>{code}</b> : <span className="text-danger">not set yet — set it in Settings</span>}
      </div>
      {exams.map((t) => (
        <div key={t._id} className="d-flex justify-content-between align-items-center gap-2 border-top pt-2 mt-2">
          <div className="small text-break">
            <div className="fw-bold">{t.title}</div>
            <span>{FRONTEND_URL}/{t.slug}/round-2</span>
          </div>
          <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => copy(`${FRONTEND_URL}/${t.slug}/round-2`, "Round 2 address")}>Copy</button>
        </div>
      ))}
    </div>
  );
}