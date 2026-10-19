import { useEffect, useState } from "react";

// Google Sign-In used to prove that the person opening an exam link owns the
// email the link was sent to.
//
// How it works (full-page sign-in, like a normal "Sign in with Google" site):
//   1. The candidate presses "Sign in with Google".
//   2. The browser goes to Google's "Choose an account" page.
//   3. After choosing, Google sends the browser to /google-callback, which saves
//      the signed Google ID token and returns to the exam link.
//   4. This component then checks the chosen account's email against the
//      registered email. The server checks it again before the exam starts.
//
// The Google client id comes from the `clientId` prop (the server sends it with
// the exam info) or, if not given, from VITE_GOOGLE_CLIENT_ID.
export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();
export const GOOGLE_CALLBACK_PATH = "/google-callback";

export const KEY_TOKEN = "gv_idtoken";
export const KEY_NONCE = "gv_nonce";
export const KEY_RETURN = "gv_return";
export const KEY_ERR = "gv_err";

export function decodeJwtPayload(token) {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(b64).split("").map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join("")
    );
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function store(k, v) {
  try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ }
}
function read(k) {
  try { return sessionStorage.getItem(k) || ""; } catch (e) { return ""; }
}
function drop(k) {
  try { sessionStorage.removeItem(k); } catch (e) { /* ignore */ }
}

function randomString() {
  const a = new Uint8Array(16);
  (window.crypto || window.msCrypto).getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

// The Google "Choose an account" page address. Pure function (easy to test).
export function buildGoogleAuthUrl({ clientId, origin, nonce }) {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: origin + GOOGLE_CALLBACK_PATH,
    response_type: "id_token",
    scope: "openid email",
    nonce,
    prompt: "select_account"
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + p.toString();
}

// props:
//   expectedEmail - the registered email this link belongs to
//   onVerified(idToken) - called once the chosen Google account matches
//   resetKey - change this value to ask for a fresh sign-in (e.g. after the server rejected the token)
//   returnTo - page to come back to after Google (default: the current address)
//   variant - "box" shows the compact "Sign in with your registered email account" card
//   clientId - Google client id (optional; falls back to VITE_GOOGLE_CLIENT_ID)
export default function GoogleVerify({ expectedEmail, onVerified, resetKey, returnTo, variant, clientId }) {
  const cid = (clientId || GOOGLE_CLIENT_ID || "").trim();
  const [error, setError] = useState("");
  const [verifiedEmail, setVerifiedEmail] = useState("");
  const expected = String(expectedEmail || "").trim().toLowerCase();

  // Coming back from Google: pick up the token that /google-callback saved.
  useEffect(() => {
    if (!cid) return;
    setVerifiedEmail("");
    const here = window.location.pathname + window.location.search;

    const err = read(KEY_ERR);
    if (err) {
      drop(KEY_ERR);
      setError(err);
      return;
    }

    const token = read(KEY_TOKEN);
    if (!token) return;
    // Only use a token that was asked for from this same exam link.
    if (read(KEY_RETURN) !== here) return;
    drop(KEY_TOKEN);
    drop(KEY_RETURN);

    const payload = decodeJwtPayload(token);
    if (!payload || !payload.email) {
      setError("Google sign-in failed. Please try again.");
      return;
    }
    const got = String(payload.email).toLowerCase();
    if (expected && got !== expected) {
      setError(
        `You signed in as ${got}, but this exam link was sent to ${expected}. ` +
        `Please sign in again with ${expected}.`
      );
      return;
    }
    setError("");
    setVerifiedEmail(got);
    onVerified(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expected, resetKey]);

  function signIn() {
    const nonce = randomString();
    store(KEY_NONCE, nonce);
    store(KEY_RETURN, returnTo || window.location.pathname + window.location.search);
    drop(KEY_TOKEN);
    drop(KEY_ERR);
    window.location.assign(
      buildGoogleAuthUrl({ clientId: cid, origin: window.location.origin, nonce })
    );
  }

  // Not configured: the exam must NOT open without the email check, so say so
  // clearly (the server refuses the sign-in as well).
  if (!cid) {
    return (
      <div className="alert alert-danger small text-start mb-3">
        <b>Exam sign-in is unavailable.</b> Email verification is not set up for this portal. Please contact the administrator.
      </div>
    );
  }

  if (variant === "box") {
    return (
      <div className="mb-3 p-3 rounded-3 border text-start" style={{ background: "#fff" }}>
        <div className="fw-bold">Sign in with your registered email account</div>
        {verifiedEmail ? (
          <div className="small text-success mt-1">
            <i className="fa-solid fa-circle-check me-1"></i>Email account verified: {verifiedEmail}. Continue during your exam&apos;s login window.
          </div>
        ) : (
          <>
            <div className="small text-muted mt-1">
              Use the Google account whose email matches your registration. You can sign in before the login window opens. Your exam still starts at its scheduled time.
            </div>
            <button type="button" onClick={signIn} className="btn btn-sm btn-outline-primary mt-2">Sign in with Google</button>
          </>
        )}
        {error && <div className="text-danger small mt-2">{error}</div>}
        <div className="mt-2"><a href="/privacy-policy" target="_blank" rel="noreferrer" className="small">Privacy notice</a></div>
      </div>
    );
  }

  return (
    <div className="mb-3 text-center">
      {verifiedEmail ? (
        <div className="text-success small fw-bold">
          <i className="fa-solid fa-circle-check me-1"></i>Verified with Google: {verifiedEmail}
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={signIn}
            className="btn w-100 fw-bold d-flex align-items-center justify-content-center"
            style={{
              background: "linear-gradient(90deg, #e8503a 0%, #f39c12 100%)",
              color: "#fff",
              padding: "14px 16px",
              borderRadius: 10,
              border: "none",
              gap: 10,
              fontSize: "1rem"
            }}
          >
            <span
              style={{
                background: "#fff", color: "#4285f4", borderRadius: "50%", width: 24, height: 24,
                display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.85rem"
              }}
            >G</span>
            Sign in with Google
          </button>
          <div className="small text-muted mt-2">
            You will be asked to choose a Google account{expected ? <> — choose <b>{expected}</b></> : null}.
          </div>
        </>
      )}
      {error && <div className="text-danger small mt-2">{error}</div>}
    </div>
  );
}