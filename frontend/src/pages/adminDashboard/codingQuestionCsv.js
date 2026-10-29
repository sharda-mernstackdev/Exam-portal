// Round 2 Question Bank <-> Excel/CSV round-trip.
// A plain .csv (no `xlsx` npm dependency) - Excel / Sheets / LibreOffice all open,
// edit and re-save .csv, so download -> edit -> re-upload works.
//
// Columns:
// Type | Question | Correct Answer | Option A | Option B | Option C | Option D | Correct Option
//
//  - Type "Text"  : fill "Correct Answer" (the candidate must type exactly this).
//  - Type "MCQ"   : fill Option A-D (at least 2) and "Correct Option" (A, B, C or D).
// The order of the rows is the order the questions are added.

export const CODING_CSV_HEADERS = [
  "Type", "Question", "Correct Answer",
  "Option A", "Option B", "Option C", "Option D", "Correct Option"
];

const LETTERS = ["A", "B", "C", "D"];

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function buildCodingQuestionsCSV(questions) {
  const usable = questions.filter((q) => q.type === "text" || q.type === "mcq");
  const rows = usable.length > 0
    ? usable.map((q) => {
        const opts = q.options || [];
        return [
          q.type === "mcq" ? "MCQ" : "Text",
          q.description || "",
          q.type === "text" ? (q.answer || "") : "",
          opts[0] ?? "", opts[1] ?? "", opts[2] ?? "", opts[3] ?? "",
          q.type === "mcq" && Number.isInteger(q.correctIndex) ? LETTERS[q.correctIndex] || "" : ""
        ];
      })
    : [
        ["Text", "Write the full form of HTML.", "HyperText Markup Language", "", "", "", "", ""],
        ["MCQ", "What is the default port of HTTPS?", "", "80", "443", "21", "8080", "B"]
      ];

  const lines = [CODING_CSV_HEADERS, ...rows].map((row) => row.map(csvEscape).join(","));
  return lines.join("\r\n");
}

export function downloadCodingQuestionsCSV(questions, filename = "round2-questions.csv") {
  const csv = buildCodingQuestionsCSV(questions);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }); // BOM so Excel picks UTF-8
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Minimal RFC4180-style CSV line splitter - handles quoted fields that
// contain commas, escaped "" quotes, and \r\n or \n line endings.
function parseCSVText(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

// Short heading kept in the bank list: the first part of the question.
export function titleFromQuestion(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > 80 ? t.slice(0, 77) + "..." : t;
}

// Parses uploaded CSV text into { questions, skipped }. `questions` are ready to
// send to the server (type, description, answer / options + correctIndex).
export function parseCodingQuestionsCSV(text) {
  const parsed = parseCSVText(text);
  if (parsed.length === 0) return { questions: [], skipped: 0 };

  const firstCell = (parsed[0][0] || "").trim().toLowerCase();
  const dataRows = firstCell === "type" ? parsed.slice(1) : parsed;
  // Files downloaded earlier still have a "Difficulty" column after "Type": it is ignored.
  const hasDifficulty = firstCell === "type" && (parsed[0][1] || "").trim().toLowerCase() === "difficulty";

  const questions = [];
  let skipped = 0;

  dataRows.forEach((r) => {
    const cells = r.map((x) => (x || "").trim());
    if (hasDifficulty) cells.splice(1, 1);
    const [typeRaw, question, answer, a, b, c, d, correctRaw] = cells;
    const type = /^mcq$/i.test(typeRaw) ? "mcq" : /^text$/i.test(typeRaw) ? "text" : "";
    if (!type || !question) { skipped++; return; }

    if (type === "text") {
      if (!answer) { skipped++; return; }
      questions.push({ type, title: titleFromQuestion(question), description: question, answer });
      return;
    }
    const options = [a, b, c, d].filter((o) => o !== "");
    const letter = (correctRaw || "").toUpperCase();
    const correctIndex = [a, b, c, d].findIndex((_, i) => LETTERS[i] === letter);
    // The correct letter must point at a filled option.
    if (options.length < 2 || correctIndex < 0 || ![a, b, c, d][correctIndex]) { skipped++; return; }
    // Empty options in the middle are not allowed: use only the filled ones in order.
    const fixedIndex = options.indexOf([a, b, c, d][correctIndex]);
    questions.push({ type, title: titleFromQuestion(question), description: question, options, correctIndex: fixedIndex });
  });

  return { questions, skipped };
}