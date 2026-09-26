import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import ExamAPI from "../api";

/**
 * useSessionGuard() — the fix for the bug where dashboard.html and
 * second_level_exam.html had no login check at all. Every locked student
 * page calls this; it redirects to /login unless there's both the local
 * lock flag and a backend-verified token.
 *
 * Returns { ready, candidateName } — render nothing (or a spinner) until
 * `ready` is true.
 */
export function useSessionGuard() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [candidateName, setCandidateName] = useState(localStorage.getItem("candidateName") || "");

  useEffect(() => {
    if (localStorage.getItem("examStatus") !== "locked" || !localStorage.getItem("studentToken")) {
      navigate("/login", { replace: true });
      return;
    }
    ExamAPI.verifyStudent()
      .then((v) => {
        setCandidateName(v.student.name);
        setReady(true);
      })
      .catch((err) => {
        localStorage.removeItem("examStatus");
        localStorage.removeItem("studentToken");
        alert(err.message || "Your session has expired. Please log in again.");
        navigate("/login", { replace: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ready, candidateName };
}
