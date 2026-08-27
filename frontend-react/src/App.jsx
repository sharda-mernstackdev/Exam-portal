import { Navigate, Route, Routes } from "react-router-dom";
import Login from "./pages/Login";
import AdminLogin from "./pages/AdminLogin";
import Round2Login from "./pages/Round2Login";
import Instructions from "./pages/Instructions";
import Dashboard from "./pages/Dashboard";
import SecondLevelExam from "./pages/SecondLevelExam";
import Summary from "./pages/Summary";
import AdminDashboard from "./pages/AdminDashboard";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin-login" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/admin-login" element={<AdminLogin />} />
      <Route path="/round2-login" element={<Round2Login />} />
      <Route path="/instructions" element={<Instructions />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/second-level-exam" element={<SecondLevelExam />} />
      <Route path="/summary" element={<Summary />} />
      <Route path="/admin-dashboard" element={<AdminDashboard />} />
    </Routes>
  );
}
