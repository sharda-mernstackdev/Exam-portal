export function formatDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * computeAnalytics(results, qualifyingPct) — mirrors the calculations that
 * used to live inline in admin_dashboard.html's renderCharts()/renderDashboard().
 * Returns everything the Dashboard and Results Report tabs need to render.
 */
export function computeAnalytics(results, qualifyingPct) {
  const hasData = results && results.length > 0;

  const scoreBrackets = { "0 - 40%": 0, "41 - 70%": 0, "71 - 100%": 0 };
  const completionBuckets = { "0 - 25%": 0, "26 - 50%": 0, "51 - 75%": 0, "76 - 100%": 0 };
  let totalAttempted = 0;
  let totalNotAttempted = 0;
  let passedCount = 0;
  let failedCount = 0;

  const rows = (results || []).map((r) => {
    const total = r.totalQuestions || 20;
    const attempted = r.userAnswers ? Object.keys(r.userAnswers).length : 0;
    const notAttempted = total - attempted;
    const scoreVal = r.score !== undefined ? r.score : attempted;
    const pct = r.percentage !== undefined ? parseFloat(r.percentage) : (total > 0 ? Math.round((scoreVal / total) * 100) : 0);
    const isPassed = pct >= qualifyingPct;

    totalAttempted += attempted;
    totalNotAttempted += notAttempted;
    if (isPassed) passedCount++; else failedCount++;

    const compPct = total > 0 ? Math.round((attempted / total) * 100) : 0;
    if (compPct <= 25) completionBuckets["0 - 25%"]++;
    else if (compPct <= 50) completionBuckets["26 - 50%"]++;
    else if (compPct <= 75) completionBuckets["51 - 75%"]++;
    else completionBuckets["76 - 100%"]++;

    if (pct <= 40) scoreBrackets["0 - 40%"]++;
    else if (pct <= 70) scoreBrackets["41 - 70%"]++;
    else scoreBrackets["71 - 100%"]++;

    return {
      id: r._id,
      name: r.name || "Unknown",
      when: r.createdAt,
      total,
      attempted,
      notAttempted,
      scoreVal,
      pct: isNaN(pct) ? 0 : pct,
      isPassed
    };
  });

  const totalQs = totalAttempted + totalNotAttempted;
  const passRate = hasData && (passedCount + failedCount) > 0 ? Math.round((passedCount / (passedCount + failedCount)) * 100) : 0;
  const attemptRate = totalQs > 0 ? Math.round((totalAttempted / totalQs) * 100) : 0;
  const avgPct = rows.length ? Math.round(rows.reduce((a, r) => a + r.pct, 0) / rows.length) : 0;

  const top = rows.slice().sort((a, b) => b.pct - a.pct).slice(0, 5);
  const chrono = rows.slice().sort((a, b) => new Date(a.when || 0) - new Date(b.when || 0));

  return {
    hasData,
    rows,
    totalCandidates: rows.length,
    totalAttempted,
    totalNotAttempted,
    totalQs,
    passedCount,
    failedCount,
    passRate,
    attemptRate,
    avgPct,
    scoreBrackets,
    completionBuckets,
    top,
    chrono
  };
}
