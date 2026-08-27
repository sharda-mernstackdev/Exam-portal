# PSK Exam Portal — Full Project (Backend + React Frontend)

This folder has everything:

```
PSK_Exam_Portal/
├── backend/           Node + Express + MongoDB API (unchanged — same as before)
└── frontend-react/    React frontend (converted from the old plain-HTML pages)
```

## 1. Backend setup

```bash
cd backend
cp .env.example .env
# edit .env: set MONGO_URI, JWT_SECRET, ADMIN_JWT_SECRET, CORS_ORIGIN
npm install
npm run seed      # creates default admin + question banks (run once)
npm start         # starts the API — note which port it prints
```

## 2. React frontend setup

```bash
cd frontend-react
npm install
```

Open `src/api.js` and make sure `API_BASE_URL` matches the port your
backend printed above, e.g.:

```js
const API_BASE_URL = "http://localhost:5050/api";
```

Then start it:

```bash
npm run dev
```

It'll print a local URL (usually `http://localhost:5173`) — open that in
your browser. Make sure the backend's `.env` → `CORS_ORIGIN` includes this
URL too.

## 3. What's in the React frontend

All 7 pages: candidate login (access code), admin login, instructions,
Round 1 exam, Round 2 coding exam, summary, and the full admin dashboard
(analytics, students, exam/question management for both rounds, results
report with PDF export, settings/access code). Fullscreen lockdown and
webcam proctoring both work the same as before.

See `frontend-react/README.md` for more detail on the frontend specifically,
and `backend`'s own docs/comments for the API.

## Going live later

- Backend needs real Node.js hosting (a VPS, Render, Railway, etc.) — plain
  PHP/MySQL shared hosting (no Node.js Selector) can't run it.
- The React frontend builds to static files (`npm run build` → `dist/`)
  which CAN go on ordinary shared hosting / cPanel, same as the old HTML
  files.
- Update `API_BASE_URL` in `src/api.js` to your real backend URL before
  running the production build, and update the backend's `CORS_ORIGIN` to
  your real frontend domain.
