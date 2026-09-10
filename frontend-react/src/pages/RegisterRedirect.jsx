import { useEffect, useState } from "react";
import LiveClock from "../components/LiveClock";
import ExamAPI from "../api";
import StudentRegister from "./StudentRegister";

// Root ("/") — auto-detects the current active exam and renders its
// registration form directly, WITHOUT navigating/changing the URL. The
// address bar stays at the bare domain the whole time.
export default function RegisterRedirect() {
  const [examId, setExamId] = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    ExamAPI.getCurrentRegistrationExam()
      .then((data) => setExamId(data.id))
      .catch(() => setNotFound(true));
  }, []);

  if (examId) return <StudentRegister examId={examId} />;

  const pageStyle = {
    background: "linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)",
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
    padding: "20px"
  };

  return (
    <div style={pageStyle}>
      <LiveClock
        style={{
          position: "absolute", top: 15, right: 20, color: "#fde047",
          background: "rgba(0,0,0,0.2)", padding: "6px 14px", borderRadius: 6, fontSize: "0.85rem"
        }}
      />
      {notFound ? (
        <div className="text-center text-white">
          <i className="fa-solid fa-circle-info fa-3x mb-3 text-warning"></i>
          <h4>No exam is currently open for registration.</h4>
          <p className="text-white-50">Please check back later or contact your administrator.</p>
        </div>
      ) : null}
    </div>
  );
}