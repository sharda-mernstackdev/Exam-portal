import { useEffect, useRef, useState } from "react";

// Google Sign-In used to prove that the person opening an exam link owns the
// email the link was sent to. VITE_GOOGLE_CLIENT_ID must be set (same value
// as on the registration page). When it is empty nothing is shown and the
// caller treats Google verification as not required.
export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();

function decodeJwtPayload(token) {
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

function loadGoogleScript() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.accounts && window.google.accounts.id) return resolve();
    const existing = document.getElementById("google-gsi-script");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", reject);
      return;
    }
    const sc = document.createElement("script");
    sc.id = "google-gsi-script";
    sc.src = "https://accounts.google.com/gsi/client";
    sc.async = true;
    sc.defer = true;
    sc.onload = () => resolve();
    sc.onerror = reject;
    document.head.appendChild(sc);
  });
}

// props:
//   expectedEmail - the registered email this link belongs to
//   onVerified(idToken) - called once the signed-in Google account matches
//   resetKey - change this value to ask for a fresh sign-in (e.g. after the server rejected the token)
export default function GoogleVerify({ expectedEmail, onVerified, resetKey }) {
  const btnRef = useRef(null);
  const [error, setError] = useState("");
  const [verifiedEmail, setVerifiedEmail] = useState("");
  const expected = String(expectedEmail || "").trim().toLowerCase();

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return undefined;
    setVerifiedEmail("");
    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        if (cancelled || !btnRef.current) return;
        btnRef.current.innerHTML = "";
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (resp) => {
            const payload = decodeJwtPayload(resp.credential);
            if (!payload || !payload.email) {
              setError("Google sign-in failed. Please try again.");
              return;
            }
            const got = String(payload.email).toLowerCase();
            if (expected && got !== expected) {
              setError(
                `You signed in as ${got}, but this exam link was sent to ${expected}. ` +
                `Open this link in Chrome signed in with ${expected}.`
              );
              return;
            }
            setError("");
            setVerifiedEmail(got);
            onVerified(resp.credential);
          }
        });
        window.google.accounts.id.renderButton(btnRef.current, {
          theme: "outline", size: "large", text: "signin_with", shape: "rectangular", width: 300
        });
      })
      .catch(() => setError("Could not load Google sign-in. Check your internet connection and refresh the page."));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expected, resetKey]);

  if (!GOOGLE_CLIENT_ID) return null;

  return (
    <div className="mb-3 text-center">
      {verifiedEmail ? (
        <div className="text-success small fw-bold">
          <i className="fa-solid fa-circle-check me-1"></i>Verified with Google: {verifiedEmail}
        </div>
      ) : (
        <>
          <div className="small text-muted mb-2">
            To protect the exam, sign in with the Google account <b>{expected || "you registered with"}</b>.
          </div>
          <div className="d-flex justify-content-center"><div ref={btnRef}></div></div>
        </>
      )}
      {error && <div className="text-danger small mt-2">{error}</div>}
    </div>
  );
}