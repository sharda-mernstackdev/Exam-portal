# Exam Portal — React Version

Full React conversion of the Exam Portal frontend. Talks to the exact same
backend API you already have running — no backend changes needed.

## All pages converted

- `/login` — candidate login (access code)
- `/admin-login` — admin login
- `/instructions` — exam instructions + 10s countdown
- `/dashboard` — Round 1 MCQ exam (sections, palette, calculator, timer)
- `/second-level-exam` — Round 2 coding exam (multi-language editor, test
  runner, timer)
- `/summary` — post-exam summary + exit
- `/admin-dashboard` — full admin panel: Dashboard (7 analytics charts),
  Students, Round 1 exam + question bank management, Round 2 exam + coding
  question bank management, Results Report (with PDF export), Settings
  (including the candidate access code)

Fullscreen lockdown and webcam proctoring work via `useExamGuard` /
`useProctor` hooks — no iframe trick needed since this is a single-page app,
so fullscreen survives navigation between routes natively.

## Running it

```bash
cd exam-portal-react
npm install
npm run dev
```

This starts a dev server (usually `http://localhost:5173`). Make sure your
backend (`backend/`) is running first — same as before (`npm start` in the
`backend` folder).

## Pointing at your backend

Open `src/api.js` and check the first line:

```js
const API_BASE_URL = "http://localhost:5050/api";
```

Change the port/host here if your backend runs somewhere else. Also update
`CORS_ORIGIN` in the backend's `.env` to include whatever URL this dev
server (or, later, your production frontend domain) runs on.

## Building for production

```bash
npm run build
```

This outputs static files into `dist/` — upload the contents of `dist/` to
your hosting (cPanel, Netlify, etc.) exactly like you would the old HTML
files. Remember to point `src/api.js`'s `API_BASE_URL` at your real backend
URL *before* running this build command (it gets baked into the built
files).

## Notes

- Chart.js, jsPDF, and jsPDF-autotable are loaded via CDN `<script>` tags in
  `index.html` (same CDNs the original HTML pages used) rather than as npm
  packages, to keep the bundle small and the behavior identical to before.
- The "Total Questions" field on the Round 1 exam creation form is
  decorative (matches the original) — it displays the live question bank
  count rather than being stored per-exam.
- The coding-question form's "Correct Output" field is kept for UI parity
  but isn't persisted by the backend schema (same limitation as the original
  vanilla-JS version — see the main project README).
