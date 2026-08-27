/*
 * api.js — thin wrapper around the Exam Portal backend REST API.
 * Same behaviour as the original vanilla-JS version used by the plain-HTML
 * pages; just exported as an ES module for use inside React components.
 *
 * Change API_BASE_URL to wherever the backend/ server is actually running.
 */
const API_BASE_URL = "http://localhost:5000/api";

function studentToken() {
  return localStorage.getItem("studentToken") || "";
}
function adminToken() {
  return sessionStorage.getItem("adminToken") || "";
}

function request(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (options.auth === "student" && studentToken()) headers.Authorization = "Bearer " + studentToken();
  if (options.auth === "admin" && adminToken()) headers.Authorization = "Bearer " + adminToken();

  return fetch(API_BASE_URL + path, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  }).then(async (res) => {
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      const err = new Error(data.message || "Request failed");
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  });
}

const ExamAPI = {
  BASE_URL: API_BASE_URL,

  // ---- Student auth ----
  studentLogin: (payload) => request("/auth/student/login", { method: "POST", body: payload }),
  round2Login: (payload) => request("/auth/round2/login", { method: "POST", body: payload }),
  verifyStudent: () => request("/auth/student/verify", { auth: "student" }),

  // ---- Admin auth ----
  adminLogin: (payload) => request("/auth/admin/login", { method: "POST", body: payload }),
  verifyAdmin: () => request("/auth/admin/verify", { auth: "admin" }),

  // ---- Settings ----
  getSettings: () => request("/settings"),
  adminGetSettings: () => request("/admin/settings", { auth: "admin" }),
  updateSettings: (payload) => request("/admin/settings", { method: "PUT", auth: "admin", body: payload }),

  // ---- Questions (round 1) ----
  getQuestions: () => request("/questions", { auth: "student" }),
  adminGetQuestions: () => request("/admin/questions", { auth: "admin" }),
  adminCreateQuestion: (payload) => request("/admin/questions", { method: "POST", auth: "admin", body: payload }),
  adminUpdateQuestion: (id, payload) => request(`/admin/questions/${id}`, { method: "PUT", auth: "admin", body: payload }),
  adminDeleteQuestion: (id) => request(`/admin/questions/${id}`, { method: "DELETE", auth: "admin" }),

  // ---- Coding questions (round 2) ----
  getCodingQuestions: () => request("/coding-questions", { auth: "student" }),
  adminGetCodingQuestions: () => request("/admin/coding-questions", { auth: "admin" }),
  adminCreateCodingQuestion: (payload) => request("/admin/coding-questions", { method: "POST", auth: "admin", body: payload }),
  adminUpdateCodingQuestion: (id, payload) => request(`/admin/coding-questions/${id}`, { method: "PUT", auth: "admin", body: payload }),
  adminDeleteCodingQuestion: (id) => request(`/admin/coding-questions/${id}`, { method: "DELETE", auth: "admin" }),

  // ---- Exams (round 1 config) ----
  adminGetExams: () => request("/admin/exams", { auth: "admin" }),
  adminCreateExam: (payload) => request("/admin/exams", { method: "POST", auth: "admin", body: payload }),
  adminUpdateExam: (id, payload) => request(`/admin/exams/${id}`, { method: "PUT", auth: "admin", body: payload }),
  adminDeleteExam: (id) => request(`/admin/exams/${id}`, { method: "DELETE", auth: "admin" }),

  // ---- Second-level exams (round 2 config) ----
  adminGetSecondLevelExams: () => request("/admin/second-level-exams", { auth: "admin" }),
  adminCreateSecondLevelExam: (payload) => request("/admin/second-level-exams", { method: "POST", auth: "admin", body: payload }),
  adminUpdateSecondLevelExam: (id, payload) => request(`/admin/second-level-exams/${id}`, { method: "PUT", auth: "admin", body: payload }),
  adminDeleteSecondLevelExam: (id) => request(`/admin/second-level-exams/${id}`, { method: "DELETE", auth: "admin" }),

  // ---- Submissions / results ----
  submitExam: (payload) => request("/submissions", { method: "POST", auth: "student", body: payload }),
  myLatestSubmission: () => request("/submissions/mine", { auth: "student" }),
  submitSecondLevel: (payload) => request("/second-level/submissions", { method: "POST", auth: "student", body: payload }),
  adminGetSubmissions: () => request("/admin/submissions", { auth: "admin" }),
  adminClearSubmissions: () => request("/admin/submissions", { method: "DELETE", auth: "admin" }),
  adminGetSecondLevelResults: () => request("/admin/second-level-results", { auth: "admin" }),
  adminClearSecondLevelResults: () => request("/admin/second-level-results", { method: "DELETE", auth: "admin" }),
  adminGetRoundProgress: () => request("/admin/round-progress", { auth: "admin" }),

  // ---- Students ----
  adminGetStudents: () => request("/admin/students", { auth: "admin" }),
  adminGetCandidateJourney: () => request("/admin/candidate-journey", { auth: "admin" }),
  adminClearStudents: () => request("/admin/students", { method: "DELETE", auth: "admin" }),

  // ---- Proctoring ----
  logProctorEvent: (payload) => request("/proctor-log", { method: "POST", auth: "student", body: payload })
};

export default ExamAPI;
