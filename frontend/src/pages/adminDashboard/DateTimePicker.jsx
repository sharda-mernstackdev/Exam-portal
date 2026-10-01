// A date + time picker that looks and behaves identically on every computer,
// regardless of the operating system's regional/locale settings.
//
// The native <input type="datetime-local"> displays AM/PM (or 24-hour, or a
// different date order) purely based on the browser/OS's own locale. Since
// this portal runs on whichever computer an admin happens to be using, that
// meant the same form could show "AM/PM" on one machine and "14:30" on
// another — confusing, and easy to misread when entering an exam's time.
//
// This component always renders the same four controls — a date field, an
// Hour (01-12) dropdown, a Minute (00-59) dropdown, and an AM/PM dropdown —
// so what the admin sees is identical on every computer. The value/onChange
// contract matches a plain input: `value` is a "YYYY-MM-DDTHH:mm" string
// (24-hour, exactly what datetime-local used, and what the backend already
// expects), and `onChange` receives the new string directly (not an event).

function pad2(n) {
  return String(n).padStart(2, "0");
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseValue(value) {
  if (!value) return { date: "", hour12: 9, minute: 0, ampm: "AM" };
  const [datePart, timePart] = value.split("T");
  const [hh, mm] = (timePart || "00:00").split(":").map(Number);
  const ampm = hh >= 12 ? "PM" : "AM";
  let hour12 = hh % 12;
  if (hour12 === 0) hour12 = 12;
  return { date: datePart || "", hour12, minute: isNaN(mm) ? 0 : mm, ampm };
}

function buildValue(date, hour12, minute, ampm) {
  if (!date) return "";
  let hh = Number(hour12) % 12;
  if (ampm === "PM") hh += 12;
  return `${date}T${pad2(hh)}:${pad2(Number(minute))}`;
}

// Converts a "YYYY-MM-DDTHH:mm" value (as produced by this picker) into an
// explicit ISO-8601 string carrying the "+05:30" (IST) offset, e.g.
// "2026-10-05T10:00:00+05:30". Every exam time in this portal is a wall-clock
// IST time, so this MUST be used wherever such a value is sent to the
// backend — sending the bare "YYYY-MM-DDTHH:mm" string instead lets the
// server's own Date() parsing decide the timezone, which silently shifts
// the saved time whenever the server itself isn't running in IST (e.g. a
// cloud host running in UTC turns "10:00" entered by the admin into
// "10:00 UTC", which then displays back as "3:30 PM" once converted to
// IST — exactly the bug this guards against). Safe to call on an empty
// value; returns it unchanged.
export function toISTISOString(value) {
  if (!value) return value;
  return `${value}:00+05:30`;
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

export default function DateTimePicker({ value, onChange, className }) {
  const { date, hour12, minute, ampm } = parseValue(value);

  function emit(nextDate, nextHour12, nextMinute, nextAmpm) {
    onChange(buildValue(nextDate, nextHour12, nextMinute, nextAmpm));
  }

  return (
    <div className={`d-flex flex-wrap gap-2 ${className || ""}`}>
      <input
        type="date"
        className="form-control"
        style={{ minWidth: 150, flex: "1 1 150px" }}
        value={date}
        onChange={(e) => emit(e.target.value, hour12, minute, ampm)}
      />
      <select
        className="form-select" style={{ width: 72 }}
        value={hour12}
        onChange={(e) => emit(date || todayStr(), Number(e.target.value), minute, ampm)}
      >
        {HOURS.map((h) => <option key={h} value={h}>{pad2(h)}</option>)}
      </select>
      <select
        className="form-select" style={{ width: 72 }}
        value={minute}
        onChange={(e) => emit(date || todayStr(), hour12, Number(e.target.value), ampm)}
      >
        {MINUTES.map((m) => <option key={m} value={m}>{pad2(m)}</option>)}
      </select>
      <select
        className="form-select" style={{ width: 80 }}
        value={ampm}
        onChange={(e) => emit(date || todayStr(), hour12, minute, e.target.value)}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}