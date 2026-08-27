import { useChart } from "../../hooks/useChart";
import { formatDate } from "./analytics";

function ChartCard({ title, icon, canvasRef, caption, donutValue, donutLabel, wide }) {
  return (
    <div className={`chart-card${wide ? " wide" : ""}`}>
      <div className="chart-title">{icon} {title}</div>
      <div className="chart-wrap">
        <canvas ref={canvasRef}></canvas>
        {donutValue !== undefined && (
          <div className="donut-center">
            <span className="big">{donutValue}</span>
            <span className="small">{donutLabel}</span>
          </div>
        )}
      </div>
      <div className="chart-caption">{caption}</div>
    </div>
  );
}

export default function DashboardTab({ analytics, qualifyingPct }) {
  const { hasData, rows, totalCandidates, totalAttempted, totalNotAttempted, totalQs, passedCount, failedCount, passRate, attemptRate, avgPct, scoreBrackets, completionBuckets, top, chrono } = analytics;

  const passData = hasData ? [passedCount, failedCount] : [1, 1];
  const passColors = hasData ? ["#16a34a", "#dc2626"] : ["#e2e8f0", "#cbd5e1"];
  const passLabels = hasData ? ["Passed", "Failed"] : ["No Data", "No Data"];

  const barScoreData = hasData ? Object.values(scoreBrackets) : [1, 2, 1];
  const barScoreColors = hasData ? ["#ef4444", "#f59e0b", "#10b981"] : ["#e2e8f0", "#cbd5e1", "#e2e8f0"];

  const compData = hasData ? Object.values(completionBuckets) : [1, 2, 1, 3];
  const compColors = hasData ? "#0284c7" : "#e2e8f0";

  const attemptData = hasData ? [totalAttempted, totalNotAttempted] : [1, 1];
  const attemptColors = hasData ? ["#9333ea", "#cbd5e1"] : ["#e2e8f0", "#f1f5f9"];

  const funnelData = hasData ? [rows.length, passedCount, failedCount] : [3, 2, 1];

  const trendLabels = chrono.length ? chrono.map((t) => (t.when ? formatDate(t.when) : t.name)) : ["—", "—", "—", "—"];
  const trendValues = chrono.length ? chrono.map((t) => t.pct) : [0, 0, 0, 0];

  const passFailRef = useChart("doughnut",
    { labels: passLabels, datasets: [{ data: passData, backgroundColor: passColors, borderWidth: 3, borderColor: "#fff", hoverOffset: 4, cutout: "65%" }] },
    { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { font: { weight: "bold" } } } } }
  );

  const scoreDistRef = useChart("bar",
    { labels: ["0 - 40%", "41 - 70%", "71 - 100%"], datasets: [{ label: "Candidates", data: barScoreData, backgroundColor: barScoreColors, borderRadius: 8, maxBarThickness: 45 }] },
    { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } } }
  );

  const completionRef = useChart("bar",
    { labels: ["0-25%", "26-50%", "51-75%", "76-100%"], datasets: [{ label: "Candidates", data: compData, backgroundColor: compColors, borderRadius: 8, maxBarThickness: 45 }] },
    { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } } }
  );

  const attemptRef = useChart("doughnut",
    { labels: hasData ? ["Attempted Qs", "Unattempted Qs"] : ["No Data", "No Data"], datasets: [{ data: attemptData, backgroundColor: attemptColors, borderWidth: 3, borderColor: "#fff", hoverOffset: 4, cutout: "65%" }] },
    { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { font: { weight: "bold" } } } } }
  );

  const funnelRef = useChart("bar",
    { labels: ["Appeared (Round 1)", "Eligible (Round 2)", "Not Qualified"], datasets: [{ label: "Candidates", data: funnelData, backgroundColor: hasData ? ["#0284c7", "#16a34a", "#dc2626"] : ["#e2e8f0", "#cbd5e1", "#e2e8f0"], borderRadius: 8, maxBarThickness: 34 }] },
    { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false } } } }
  );

  const topRef = useChart("bar",
    {
      labels: top.length ? top.map((t) => t.name) : ["No Data", "No Data", "No Data"],
      datasets: [{ label: "Score %", data: top.length ? top.map((t) => t.pct) : [1, 2, 3], backgroundColor: top.length ? top.map((t) => (t.pct >= qualifyingPct ? "#16a34a" : "#f59e0b")) : "#e2e8f0", borderRadius: 8, maxBarThickness: 26 }]
    },
    { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, max: 100, ticks: { callback: (v) => v + "%" } }, y: { grid: { display: false } } } }
  );

  const trendRef = useChart("line",
    {
      labels: trendLabels,
      datasets: [
        { label: "Candidate Score %", data: trendValues, borderColor: "#0284c7", backgroundColor: "rgba(2,132,199,0.12)", fill: true, tension: 0.35, pointRadius: 4, pointBackgroundColor: "#0284c7" },
        { label: "Passing Criterion", data: trendLabels.map(() => qualifyingPct), borderColor: "#dc2626", borderDash: [6, 6], pointRadius: 0, fill: false, tension: 0 }
      ]
    },
    { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { font: { weight: "bold" } } } }, scales: { y: { beginAtZero: true, max: 100, ticks: { callback: (v) => v + "%" } }, x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } } } }
  );

  return (
    <section className="page-section active">
      <div className="section-heading">Executive Dashboard</div>
      <div className="section-sub">Comprehensive visual analytics derived from Student submissions and Results Report criteria</div>

      <div className="stats-row">
        <div className="stat-card" style={{ borderLeft: "4px solid #0284c7" }}>
          <div><div className="stat-label">Total Candidates</div><div className="stat-num">{totalCandidates}</div></div>
          <div className="stat-icon candidates"><i className="fa-solid fa-users"></i></div>
        </div>
        <div className="stat-card" style={{ borderLeft: "4px solid #16a34a" }}>
          <div><div className="stat-label">Candidates Passed</div><div className="stat-num text-success">{passedCount}</div></div>
          <div className="stat-icon passed"><i className="fa-solid fa-circle-check"></i></div>
        </div>
        <div className="stat-card" style={{ borderLeft: "4px solid #dc2626" }}>
          <div><div className="stat-label">Candidates Failed</div><div className="stat-num text-danger">{failedCount}</div></div>
          <div className="stat-icon failed"><i className="fa-solid fa-circle-xmark"></i></div>
        </div>
        <div className="stat-card" style={{ borderLeft: "4px solid #d97706" }}>
          <div><div className="stat-label">Questions Attempted</div><div className="stat-num text-warning">{totalAttempted}</div></div>
          <div className="stat-icon attempted"><i className="fa-solid fa-list-check"></i></div>
        </div>
        <div className="stat-card" style={{ borderLeft: "4px solid #9333ea" }}>
          <div><div className="stat-label">Avg. Score</div><div className="stat-num" style={{ color: "#9333ea" }}>{avgPct}%</div></div>
          <div className="stat-icon avg"><i className="fa-solid fa-chart-line"></i></div>
        </div>
      </div>

      <div className="card-box">
        <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
          <h6><i className="fa-solid fa-chart-pie me-2 text-primary"></i>Visual Exam Analytics</h6>
          <span className="badge bg-light text-dark border small fw-bold">Passing Criterion: ≥ {qualifyingPct}%</span>
        </div>
        <div className="sub">Dynamic graphical charts generated from Students and Results Report data</div>

        <div className="chart-grid">
          <ChartCard title="Pass vs. Fail Ratio" icon={<i className="fa-solid fa-circle-half-stroke me-1 text-success"></i>} canvasRef={passFailRef}
            donutValue={hasData ? passRate + "%" : "--"} donutLabel="Pass Rate"
            caption={hasData ? <><span>Passed: <b className="text-success">{passedCount}</b></span><span>Failed: <b className="text-danger">{failedCount}</b></span><span>Criterion: <b>&ge; {qualifyingPct}%</b></span></> : <span>No submissions yet</span>} />

          <ChartCard title="Score Performance Brackets" icon={<i className="fa-solid fa-chart-column me-1 text-info"></i>} canvasRef={scoreDistRef}
            caption={hasData ? <><span>Low: <b>{scoreBrackets["0 - 40%"]}</b></span><span>Mid: <b>{scoreBrackets["41 - 70%"]}</b></span><span>High: <b>{scoreBrackets["71 - 100%"]}</b></span></> : <span>No submissions yet</span>} />

          <ChartCard title="Completion Rate Ranges" icon={<i className="fa-solid fa-bars-progress me-1 text-warning"></i>} canvasRef={completionRef}
            caption={hasData ? <><span>Candidates: <b>{rows.length}</b></span><span>Mostly complete (76-100%): <b>{completionBuckets["76 - 100%"]}</b></span></> : <span>No submissions yet</span>} />

          <ChartCard title="Question Attempt Ratio" icon={<i className="fa-solid fa-chart-pie me-1 text-danger"></i>} canvasRef={attemptRef}
            donutValue={hasData ? attemptRate + "%" : "--"} donutLabel="Attempted"
            caption={hasData ? <><span>Attempted: <b>{totalAttempted}</b></span><span>Unattempted: <b>{totalNotAttempted}</b></span><span>Total Qs: <b>{totalQs}</b></span></> : <span>No submissions yet</span>} />

          <ChartCard title="Round 1 → Round 2 Funnel" icon={<i className="fa-solid fa-filter-circle-dollar me-1 text-primary"></i>} canvasRef={funnelRef}
            caption={hasData ? <span>Round 2 shortlisting rate: <b>{passRate}%</b> of Round 1 candidates</span> : <span>No submissions yet</span>} />

          <ChartCard title="Top 5 Performing Candidates" icon={<i className="fa-solid fa-medal me-1 text-warning"></i>} canvasRef={topRef}
            caption={top.length ? <span>Highest score: <b>{top[0].name} ({top[0].pct}%)</b></span> : <span>No submissions yet</span>} />

          <ChartCard wide title="Score Trend Across Submissions" icon={<i className="fa-solid fa-arrow-trend-up me-1 text-info"></i>} canvasRef={trendRef}
            caption={chrono.length ? <><span>Average score: <b>{avgPct}%</b></span><span>Best: <b>{Math.max(...trendValues)}%</b></span><span>Lowest: <b>{Math.min(...trendValues)}%</b></span><span>Submissions plotted: <b>{chrono.length}</b></span></> : <span>No submissions yet</span>} />
        </div>
      </div>

      <div className="card-box">
        <h6 className="mb-1"><i className="fa-solid fa-clock-rotate-left me-2 text-secondary"></i>Recent Candidates Evaluation</h6>
        <div className="sub mb-3">Live feed of candidates' recent results and pass/fail standings</div>
        <div className="table-responsive">
          <table className="table candidates-table mb-0 align-middle">
            <thead><tr><th>Candidate Name</th><th>Submitted Date</th><th>Attempted Qs</th><th>Score %</th><th>Result Status</th></tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={5} className="text-center text-muted py-4">No submissions recorded yet.</td></tr>
              ) : (
                rows.slice().reverse().slice(0, 5).map((r) => (
                  <tr key={r.id}>
                    <td className="name-cell">{r.name}</td>
                    <td className="small text-muted">{formatDate(r.when)}</td>
                    <td>{r.attempted} / {r.total}</td>
                    <td className="fw-bold">{r.pct}%</td>
                    <td>{r.isPassed ? <span className="badge-pill pass"><i className="fa-solid fa-check me-1"></i> PASSED</span> : <span className="badge-pill fail"><i className="fa-solid fa-xmark me-1"></i> FAILED</span>}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
