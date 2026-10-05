import { useEffect, useRef, useState } from "react";

// Date + time picker that looks identical on every computer, regardless of
// OS/browser locale. Date is picked from a custom calendar popup (always shown
// as DD-MM-YYYY); time is Hour : Minute with an AM/PM toggle.
//
// Contract: `value` is a "YYYY-MM-DDTHH:mm" string (24-hour), `onChange`
// receives the new string directly (not an event). Empty value = "".

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const WEEKDAYS_LONG = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

function pad2(n) {
  return String(n).padStart(2, "0");
}

function todayParts() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

function parseValue(value) {
  const t = todayParts();
  if (!value) {
    return { hasDate: false, year: t.year, month: t.month, day: t.day, hour12: 9, minute: 0, ampm: "AM" };
  }
  const [datePart, timePart] = value.split("T");
  const [y, m, d] = (datePart || "").split("-").map(Number);
  const [hh, mm] = (timePart || "00:00").split(":").map(Number);
  const hasDate = !isNaN(y) && !isNaN(m) && !isNaN(d);
  let hour12 = (isNaN(hh) ? 0 : hh) % 12;
  if (hour12 === 0) hour12 = 12;
  return {
    hasDate,
    year: hasDate ? y : t.year,
    month: hasDate ? m : t.month,
    day: hasDate ? d : t.day,
    hour12,
    minute: isNaN(mm) ? 0 : mm,
    ampm: hh >= 12 ? "PM" : "AM"
  };
}

function buildValue(year, month, day, hour12, minute, ampm) {
  if (!year || !month || !day) return "";
  let hh = Number(hour12) % 12;
  if (ampm === "PM") hh += 12;
  return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hh)}:${pad2(Number(minute))}`;
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

export default function DateTimePicker({ value, onChange, className, min }) {
  const p = parseValue(value);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState({ year: p.year, month: p.month });
  const wrapRef = useRef(null);

  // Close the calendar when clicking outside of it.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  function toggleCalendar() {
    if (!open) setView({ year: p.year, month: p.month });
    setOpen(!open);
  }

  // Merge a change into the current value. If no date is chosen yet and the
  // admin touches the time first, today's date is used.
  function emit(patch) {
    const n = { ...p, ...patch };
    onChange(buildValue(n.year, n.month, n.day, n.hour12, n.minute, n.ampm));
  }

  function pickDay(day) {
    emit({ year: view.year, month: view.month, day });
    setOpen(false);
  }

  function pickToday() {
    const t = todayParts();
    emit({ year: t.year, month: t.month, day: t.day });
    setOpen(false);
  }

  function clearAll() {
    onChange("");
    setOpen(false);
  }

  function shiftMonth(delta) {
    setView((v) => {
      let m = v.month + delta;
      let y = v.year;
      if (m < 1) { m = 12; y -= 1; }
      if (m > 12) { m = 1; y += 1; }
      return { year: y, month: m };
    });
  }

  // Calendar grid
  const firstDow = new Date(view.year, view.month - 1, 1).getDay();
  const daysInMonth = new Date(view.year, view.month, 0).getDate();
  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const t = todayParts();

  const dateLabel = p.hasDate ? `${pad2(p.day)}-${pad2(p.month)}-${p.year}` : "";
  const weekday = p.hasDate ? WEEKDAYS_LONG[new Date(p.year, p.month - 1, p.day).getDay()] : "";

  return (
    <div className={className || ""} ref={wrapRef} style={{ position: "relative" }}>
      {/* DATE — click opens calendar */}
      <button
        type="button"
        className="form-control d-flex align-items-center justify-content-between text-start bg-white"
        onClick={toggleCalendar}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className={dateLabel ? "" : "text-muted"}>
          {dateLabel ? `${dateLabel}  (${weekday})` : "DD-MM-YYYY — select date"}
        </span>
        <i className="fa-solid fa-calendar-days text-secondary"></i>
      </button>

      {open && (
        <div
          role="dialog"
          className="bg-white border rounded shadow p-2"
          style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 1050, width: 280 }}
        >
          <div className="d-flex align-items-center justify-content-between mb-2">
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => shiftMonth(-1)} aria-label="Previous month">
              <i className="fa-solid fa-chevron-left"></i>
            </button>
            <div className="fw-bold">{MONTH_NAMES[view.month - 1]} {view.year}</div>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => shiftMonth(1)} aria-label="Next month">
              <i className="fa-solid fa-chevron-right"></i>
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
            {WEEKDAYS.map((w) => (
              <div key={w} className="text-center small fw-bold text-secondary py-1">{w}</div>
            ))}
            {cells.map((day, i) => {
              if (day === null) return <div key={`e${i}`} />;
              const dateStr = `${view.year}-${pad2(view.month)}-${pad2(day)}`;
              const disabled = !!min && dateStr < min;
              const selected = p.hasDate && p.year === view.year && p.month === view.month && p.day === day;
              const isToday = t.year === view.year && t.month === view.month && t.day === day;
              return (
                <button
                  key={day}
                  type="button"
                  disabled={disabled}
                  onClick={() => pickDay(day)}
                  className="btn btn-sm"
                  style={{
                    padding: "6px 0",
                    background: selected ? "#212529" : "transparent",
                    color: selected ? "#fff" : disabled ? "#adb5bd" : "#212529",
                    border: isToday && !selected ? "1px solid #212529" : "1px solid transparent",
                    fontWeight: selected || isToday ? 700 : 400
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="d-flex justify-content-between mt-2 pt-2 border-top">
            <button type="button" className="btn btn-sm btn-link text-decoration-none" onClick={clearAll}>Clear</button>
            <button type="button" className="btn btn-sm btn-link text-decoration-none fw-bold" onClick={pickToday}>Today</button>
          </div>
        </div>
      )}

      {/* TIME — hour : minute  [AM | PM] */}
      <div className="d-flex align-items-center gap-2 mt-2">
        <i className="fa-regular fa-clock text-secondary"></i>
        <select
          className="form-select" style={{ width: 72 }}
          value={p.hour12}
          onChange={(e) => emit({ hour12: Number(e.target.value) })}
          aria-label="Hour"
        >
          {HOURS.map((h) => <option key={h} value={h}>{pad2(h)}</option>)}
        </select>
        <span className="fw-bold">:</span>
        <select
          className="form-select" style={{ width: 72 }}
          value={p.minute}
          onChange={(e) => emit({ minute: Number(e.target.value) })}
          aria-label="Minute"
        >
          {MINUTES.map((m) => <option key={m} value={m}>{pad2(m)}</option>)}
        </select>
        <div className="btn-group" role="group" aria-label="AM or PM">
          {["AM", "PM"].map((x) => (
            <button
              key={x}
              type="button"
              className={`btn fw-bold ${p.ampm === x ? "btn-dark" : "btn-outline-secondary"}`}
              onClick={() => emit({ ampm: x })}
            >
              {x}
            </button>
          ))}
        </div>
      </div>

      {p.hasDate && (
        <div className="form-text mt-1">
          <i className="fa-solid fa-circle-check text-success me-1"></i>
          {weekday}, {pad2(p.day)} {MONTH_SHORT[p.month - 1]} {p.year} · {pad2(p.hour12)}:{pad2(p.minute)} {p.ampm}
        </div>
      )}
    </div>
  );
}