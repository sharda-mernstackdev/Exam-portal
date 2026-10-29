// Round 2 grading (text-box and MCQ questions). One mark per question.
//
//  - text question: the typed answer must be the same as the answer stored by
//    the admin. ALL spaces / tabs / line breaks are ignored, and capital /
//    small letters do not matter ("Largest:" = "largest:"). Everything else
//    (spelling, brackets, quotes, symbols) must match exactly.
//  - mcq question: the chosen option number must be the stored correct one.

// Used for comparing only: no whitespace at all, all lower case.
function compareKey(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/[\s\u200B-\u200D\uFEFF]+/g, '')
    .toLowerCase();
}

function normalizeText(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isCorrectText(question, typed) {
  const expected = compareKey(question.answer);
  if (!expected) return false;
  return compareKey(typed) === expected;
}

// `chosen` is the option number sent by the browser ("0", "1", ...).
function chosenIndex(question, chosen) {
  const n = Number(chosen);
  const count = Array.isArray(question.options) ? question.options.length : 0;
  if (chosen === '' || chosen === null || chosen === undefined || !Number.isInteger(n) || n < 0 || n >= count) return -1;
  return n;
}

function isCorrectMcq(question, chosen) {
  const idx = chosenIndex(question, chosen);
  return idx >= 0 && idx === Number(question.correctIndex);
}

module.exports = { normalizeText, compareKey, isCorrectText, chosenIndex, isCorrectMcq };