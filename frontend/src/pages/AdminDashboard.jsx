import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAdminGuard } from "../hooks/useAdminGuard";
import ExamAPI from "../api";
import DashboardTab from "./adminDashboard/DashboardTab";
import StudentsTab from "./adminDashboard/StudentsTab";
import ExamManagementTab from "./adminDashboard/ExamManagementTab";
import Round2Tab from "./adminDashboard/Round2Tab";
import ResultsReportTab from "./adminDashboard/ResultsReportTab";
import SettingsTab from "./adminDashboard/SettingsTab";
import { computeAnalytics } from "./adminDashboard/analytics";
import "./AdminDashboard.css";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { ready } = useAdminGuard();

  const [activeTab, setActiveTab] = useState("dashboard");
  const [examMenuOpen, setExamMenuOpen] = useState(true);

  const [exams, setExams] = useState([]);
  const [secondExams, setSecondExams] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [codingQuestions, setCodingQuestions] = useState([]);
  const [students, setStudents] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [secondLevelResults, setSecondLevelResults] = useState([]);
  const [journey, setJourney] = useState([]);
  const [settings, setSettings] = useState({});
  const [loaded, setLoaded] = useState(false);

  const adminEmail = sessionStorage.getItem("adminEmail") || "";

  const loadAll = useCallback(() => {
    return Promise.all([
      ExamAPI.adminGetExams(),
      ExamAPI.adminGetSecondLevelExams(),
      ExamAPI.adminGetQuestions(),
      ExamAPI.adminGetCodingQuestions(),
      ExamAPI.adminGetStudents(),
      ExamAPI.adminGetSubmissions(),
      ExamAPI.adminGetSecondLevelResults(),
      ExamAPI.adminGetSettings(),
      ExamAPI.adminGetCandidateJourney()
    ]).then(([ex, sx, q, cq, st, sub, slr, set, journeyRows]) => {
      setExams(ex);
      setSecondExams(sx);
      setQuestions(q);
      setCodingQuestions(cq);
      setStudents(st);
      setSubmissions(sub);
      setSecondLevelResults(slr);
      setSettings(set);
      setJourney(journeyRows);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    loadAll().catch((err) => {
      alert(err.message || "Could not load data from the server.");
    });
  }, [ready, loadAll]);

  function handleLogout() {
    sessionStorage.removeItem("adminSession");
    sessionStorage.removeItem("adminToken");
    sessionStorage.removeItem("adminEmail");
    navigate("/admin-login", { replace: true });
  }

  if (!ready || !loaded) return null;

  const qualifyingPct = Number(settings.qualifyingPct) || 70;
  const analytics = computeAnalytics(submissions, qualifyingPct);

  return (
    <div>
      <div className="header-bar d-flex flex-wrap justify-content-between align-items-center gap-2">
        <div className="d-flex align-items-center gap-3">
          <div className="portal-title"><i className="fa-solid fa-user-shield me-1"></i> Online Exam Portal — Admin</div>
          <span className="header-datetime d-none d-md-inline">{adminEmail}</span>
        </div>
        <div className="d-flex align-items-center gap-3">
          <span className="text-white small d-none d-md-inline"><i className="fa-solid fa-circle text-success me-1"></i> Live Session</span>
          <button className="btn btn-logout btn-sm" onClick={handleLogout}>
            <i className="fa-solid fa-right-from-bracket me-1"></i> Logout
          </button>
        </div>
      </div>

      <div className="app-shell">
        <div className="sidebar">
          <button className={`menu-item ${activeTab === "dashboard" ? "active" : ""}`} onClick={() => setActiveTab("dashboard")}>
            <span className="ico">🏠</span> Dashboard
          </button>
          <button className={`menu-item ${activeTab === "students" ? "active" : ""}`} onClick={() => setActiveTab("students")}>
            <span className="ico">👥</span> Students
          </button>

          <div className="nav-item-group w-100">
            <button className="menu-item" onClick={() => setExamMenuOpen(!examMenuOpen)}>
              <span className="ico">📝</span> Exam
              <i className={`fa-solid ${examMenuOpen ? "fa-chevron-up" : "fa-chevron-down"} ms-auto`} style={{ fontSize: "0.75rem", color: "#64748b" }}></i>
            </button>
            <div className="sub-menu-list" style={{ display: examMenuOpen ? "block" : "none" }}>
              <button className={`menu-item ${activeTab === "examManagement" ? "active" : ""}`} onClick={() => setActiveTab("examManagement")}>
                <span className="ico text-muted" style={{ fontSize: "0.5rem", marginRight: 2 }}>⏺</span> Round 1
              </button>
              <button className={`menu-item ${activeTab === "round2" ? "active" : ""}`} onClick={() => setActiveTab("round2")}>
                <span className="ico text-muted" style={{ fontSize: "0.5rem", marginRight: 2 }}>⏺</span> Round 2
              </button>
            </div>
          </div>

          <button className={`menu-item ${activeTab === "resultsReport" ? "active" : ""}`} onClick={() => setActiveTab("resultsReport")}>
            <span className="ico">📄</span> Results Report
          </button>
          <button className={`menu-item ${activeTab === "settings" ? "active" : ""}`} onClick={() => setActiveTab("settings")}>
            <span className="ico">⚙️</span> Settings
          </button>
          <button className="menu-item logout" onClick={handleLogout}>
            <span className="ico">🚪</span> Logout
          </button>
        </div>

        <div className="main-wrapper">
          {activeTab === "dashboard" && <DashboardTab analytics={analytics} qualifyingPct={qualifyingPct} />}
          {activeTab === "students" && <StudentsTab students={students} onDataChanged={loadAll} />}
          {activeTab === "examManagement" && (
            <ExamManagementTab
              exams={exams}
              questions={questions}
              onExamsChanged={loadAll}
              onQuestionsChanged={loadAll}
            />
          )}
          {activeTab === "round2" && (
            <Round2Tab
              secondExams={secondExams}
              codingQuestions={codingQuestions}
              onSecondExamsChanged={loadAll}
              onCodingQuestionsChanged={loadAll}
            />
          )}
          {activeTab === "resultsReport" && (
            <ResultsReportTab journey={journey} qualifyingPct={qualifyingPct} />
          )}
          {activeTab === "settings" && (
            <SettingsTab
              settings={settings}
              totals={{ students: students.length, exams: exams.length }}
              adminEmail={adminEmail}
              onSettingsChanged={loadAll}
            />
          )}
        </div>
      </div>
    </div>
  );
}
