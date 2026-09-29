// Question Bank <-> Excel/CSV round-trip.
//
// We deliberately generate a plain .csv (not a real .xlsx) with no extra
// npm dependency: Excel, Google Sheets and LibreOffice all open, edit and
// re-save .csv natively, so "download the sheet, add rows in Excel, upload
// it back" works exactly the same as a real .xlsx would — without pulling
// in the `xlsx` (SheetJS) npm package, whose only registry build currently
// carries an unpatched high-severity advisory (GHSA-4r6h-8v6p-xvw6).
//
// Column order matches the "Add MCQ to Database" form fields exactly:
// Category | Question Text | Option A | Option B | Option C | Option D | Correct Option (A/B/C/D)

export const CSV_HEADERS = ["Category", "Question Text", "Option A", "Option B", "Option C", "Option D", "Correct Option"];

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

// Builds the downloadable CSV text for the current question bank. If the
// bank is empty, includes one example row so the admin sees the expected
// format immediately instead of a bare header row.
export function buildQuestionsCSV(questions) {
  const rows = questions.length > 0
    ? questions.map((q) => [
        q.category || "",
        q.text || "",
        q.options?.[0] || "",
        q.options?.[1] || "",
        q.options?.[2] || "",
        q.options?.[3] || "",
        String.fromCharCode(65 + (Number(q.correctOption) || 0))
      ])
    : [["Aptitude", "2 + 2 = ?", "3", "4", "5", "6", "B"]];

  const lines = [CSV_HEADERS, ...rows].map((row) => row.map(csvEscape).join(","));
  return lines.join("\r\n");
}

export function downloadQuestionsCSV(questions, filename = "question-bank.csv") {
  const csv = buildQuestionsCSV(questions);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }); // BOM so Excel picks UTF-8
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

// Parses uploaded CSV text into { questions, skipped }.
// `questions` is ready to hand to ExamAPI.adminBulkCreateQuestions.
// `skipped` counts rows that were dropped for missing/invalid data, so the
// caller can tell the admin "N added, M skipped".
export function parseQuestionsCSV(text) {
  const rows = parseCSVText(text);
  if (rows.length === 0) return { questions: [], skipped: 0 };

  // Drop the header row if the first cell looks like "Category" (case-insensitive).
  const firstCell = (rows[0][0] || "").trim().toLowerCase();
  const dataRows = firstCell === "category" ? rows.slice(1) : rows;

  const questions = [];
  let skipped = 0;

  dataRows.forEach((r) => {
    const [category, text, optA, optB, optC, optD, correctRaw] = r.map((c) => (c || "").trim());
    const options = [optA, optB, optC, optD];
    const letter = (correctRaw || "").toUpperCase().trim().charAt(0);
    const correctOption = "ABCD".indexOf(letter);

    if (!category || !text || options.some((o) => !o) || correctOption === -1) {
      skipped++;
      return;
    }
    questions.push({ category, text, options, correctOption });
  });

  return { questions, skipped };
}