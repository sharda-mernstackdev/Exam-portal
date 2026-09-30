// Round 2 Coding Question Bank <-> Excel/CSV round-trip.
// Same approach as questionCsv.js (Round 1's Question Bank): a plain .csv,
// no `xlsx` npm dependency — Excel/Sheets/LibreOffice all open, edit and
// re-save .csv natively, so download -> edit -> re-upload works the same
// as a real .xlsx would.
//
// Column order matches the "Manage Round 2 Coding Questions" form fields:
// Title | Difficulty (Easy/Medium/Hard) | Description | Ex1 Input | Ex1 Output |
// Ex2 Input | Ex2 Output | Ex3 Input | Ex3 Output | Correct Output
//
// Note: "Input" columns are the comma-separated argument list exactly as
// typed into the "Ex N Input" fields on the form (e.g. "1, 2, 3"), not a
// pre-built JSON array — the same text the form itself expects.

export const CODING_CSV_HEADERS = [
  "Title", "Difficulty", "Description",
  "Ex1 Input", "Ex1 Output", "Ex2 Input", "Ex2 Output", "Ex3 Input", "Ex3 Output",
  "Correct Output"
];

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

// Builds the downloadable CSV text for the current coding-question bank. If
// the bank is empty, includes one example row so the admin sees the
// expected format immediately instead of a bare header row.
export function buildCodingQuestionsCSV(questions) {
  const rows = questions.length > 0
    ? questions.map((q) => {
        const ex = q.examples || [];
        return [
          q.title || "",
          q.difficulty || "Medium",
          q.description || "",
          ex[0]?.input ?? "",
          ex[0]?.output ?? "",
          ex[1]?.input ?? "",
          ex[1]?.output ?? "",
          ex[2]?.input ?? "",
          ex[2]?.output ?? "",
          q.correctOutput || ""
        ];
      })
    : [["Find Max Element", "Easy", "Return the largest number in the given array.", "1, 2, 3", "3", "-1, -2", "-1", "10, 20", "20", "20"]];

  const lines = [CODING_CSV_HEADERS, ...rows].map((row) => row.map(csvEscape).join(","));
  return lines.join("\r\n");
}

export function downloadCodingQuestionsCSV(questions, filename = "round2-coding-questions.csv") {
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

// Minimal RFC4180-style CSV line splitter — handles quoted fields that
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

const VALID_DIFFICULTY = new Set(["Easy", "Medium", "Hard"]);

// Parses uploaded CSV text into { rows, skipped }. `rows` are plain field
// objects (title/difficulty/description/ex1In/ex1Out/.../correctOutput) —
// the caller (Round2Tab) turns each into the full CodingQuestion payload
// (funcName, starterCode, testCases) using the same logic as the manual
// "Add Coding Problem" form, so uploaded rows behave identically either way.
export function parseCodingQuestionsCSV(text) {
  const parsed = parseCSVText(text);
  if (parsed.length === 0) return { rows: [], skipped: 0 };

  const firstCell = (parsed[0][0] || "").trim().toLowerCase();
  const dataRows = firstCell === "title" ? parsed.slice(1) : parsed;

  const rows = [];
  let skipped = 0;

  dataRows.forEach((r) => {
    const [title, difficultyRaw, description, ex1In, ex1Out, ex2In, ex2Out, ex3In, ex3Out, correctOutput] =
      r.map((c) => (c || "").trim());

    const difficulty = VALID_DIFFICULTY.has(difficultyRaw) ? difficultyRaw : "Medium";

    if (!title || !description || !ex1In || !ex1Out || !ex2In || !ex2Out || !ex3In || !ex3Out || !correctOutput) {
      skipped++;
      return;
    }
    rows.push({ title, difficulty, description, ex1In, ex1Out, ex2In, ex2Out, ex3In, ex3Out, correctOutput });
  });

  return { rows, skipped };
}