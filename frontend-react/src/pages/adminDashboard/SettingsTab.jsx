import { useEffect, useState } from "react";
import ExamAPI from "../../api";

export default function SettingsTab({ settings, totals, adminEmail, onSettingsChanged }) {
  const [form, setForm] = useState({ portalName: "", qualifyingPct: 70, accessCode: "", round2AccessCode: "" });

  useEffect(() => {
    setForm({
      portalName: settings.portalName || "Online Exam Portal",
      qualifyingPct: settings.qualifyingPct ?? 70,
      accessCode: settings.accessCode || "",
      round2AccessCode: settings.round2AccessCode || ""
    });
  }, [settings]);

  function handleRegenerate() {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    setForm({ ...form, accessCode: code });
  }

  function handleRegenerateRound2() {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    setForm({ ...form, round2AccessCode: code });
  }

  function handleSubmit(e) {
    e.preventDefault();
    ExamAPI.updateSettings({
      portalName: form.portalName.trim() || "Online Exam Portal",
      qualifyingPct: Number(form.qualifyingPct) || 70,
      accessCode: form.accessCode.trim().toUpperCase(),
      round2AccessCode: form.round2AccessCode.trim().toUpperCase()
    })
      .then(() => {
        onSettingsChanged();
        alert("Settings saved.");
      })
      .catch((err) => alert(err.message || "Could not save settings."));
  }

  return (
    <section className="page-section active">
      <div className="section-heading">Settings</div>
      <div className="section-sub">Admin account and portal preferences</div>

      <div className="card-box">
        <h6>Overview</h6>
        <div className="sub">Read-only portal statistics</div>
        <div className="detail-grid">
          <div className="detail-field"><div className="k">Admin Email</div><div className="v">{adminEmail || "-"}</div></div>
          <div className="detail-field"><div className="k">Total Candidates Stored</div><div className="v">{totals.students}</div></div>
          <div className="detail-field"><div className="k">Total Exams Created</div><div className="v">{totals.exams}</div></div>
        </div>
      </div>

      <div className="card-box">
        <h6>Portal Preferences</h6>
        <div className="sub">Configure how the portal behaves</div>
        <form className="row g-3 align-items-end" onSubmit={handleSubmit}>
          <div className="col-md-5">
            <label className="form-label small fw-bold text-secondary">Portal Name</label>
            <input type="text" className="form-control" placeholder="Online Exam Portal"
              value={form.portalName} onChange={(e) => setForm({ ...form, portalName: e.target.value })} />
          </div>
          <div className="col-md-4">
            <label className="form-label small fw-bold text-secondary">Qualifying % for Second Level & Pass Status</label>
            <input type="number" className="form-control" min="0" max="100" placeholder="70"
              value={form.qualifyingPct} onChange={(e) => setForm({ ...form, qualifyingPct: e.target.value })} />
          </div>
          <div className="col-md-3">
            <button type="submit" className="btn btn-dark w-100 fw-bold">Save Settings</button>
          </div>
          <div className="col-md-6">
            <label className="form-label small fw-bold text-secondary">Candidate Access Code (Round 1)</label>
            <div className="input-group">
              <input type="text" className="form-control text-uppercase" placeholder="e.g. TCS2026"
                value={form.accessCode} onChange={(e) => setForm({ ...form, accessCode: e.target.value })} />
              <button type="button" className="btn btn-outline-secondary" title="Generate a new random code" onClick={handleRegenerate}>
                <i className="fa-solid fa-shuffle me-1"></i>Regenerate
              </button>
            </div>
            <div className="form-text">Students enter this code (instead of a password) to log in for Round 1.</div>
          </div>
          <div className="col-md-6">
            <label className="form-label small fw-bold text-secondary">Round 2 Access Code</label>
            <div className="input-group">
              <input type="text" className="form-control text-uppercase" placeholder="e.g. TCS2026R2"
                value={form.round2AccessCode} onChange={(e) => setForm({ ...form, round2AccessCode: e.target.value })} />
              <button type="button" className="btn btn-outline-secondary" title="Generate a new random code" onClick={handleRegenerateRound2}>
                <i className="fa-solid fa-shuffle me-1"></i>Regenerate
              </button>
            </div>
            <div className="form-text">Sent automatically to candidates who pass Round 1. Used on the separate Round 2 sign-in page.</div>
          </div>
        </form>
      </div>
    </section>
  );
}
