import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import ExamAPI from "../api";

export function useAdminGuard() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem("adminSession") !== "active" || !sessionStorage.getItem("adminToken")) {
      navigate("/admin-login", { replace: true });
      return;
    }
    ExamAPI.verifyAdmin()
      .then(() => setReady(true))
      .catch((err) => {
        sessionStorage.removeItem("adminSession");
        sessionStorage.removeItem("adminToken");
        sessionStorage.removeItem("adminEmail");
        alert(err.message || "Your admin session has expired. Please log in again.");
        navigate("/admin-login", { replace: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ready };
}
