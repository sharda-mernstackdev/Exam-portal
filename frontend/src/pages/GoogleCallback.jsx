import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { decodeJwtPayload, KEY_ERR, KEY_NONCE, KEY_RETURN, KEY_TOKEN } from "../components/GoogleVerify";

// Google sends the browser back here after the candidate chose an account.
// The signed ID token is in the address (#id_token=...). This page saves it,
// then goes straight back to the exam link the candidate came from. The exam
// link page compares the account's email with the registered email.
export default function GoogleCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    let back = "/";
    try {
      back = sessionStorage.getItem(KEY_RETURN) || "/";
    } catch (e) { /* ignore */ }
    // Never follow a return address that points to another website.
    if (!back.startsWith("/") || back.startsWith("//")) back = "/";

    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const idToken = hash.get("id_token");
    const gErr = hash.get("error");
    let msg = "";
    try {
      if (gErr) {
        msg = gErr === "access_denied"
          ? "Google sign-in was cancelled. Please try again."
          : "Google sign-in failed. Please try again.";
      } else if (!idToken) {
        msg = "Google sign-in failed. Please try again.";
      } else {
        const payload = decodeJwtPayload(idToken);
        const nonce = sessionStorage.getItem(KEY_NONCE);
        if (!payload || !nonce || payload.nonce !== nonce) {
          msg = "Google sign-in could not be verified. Please try again.";
        } else {
          sessionStorage.setItem(KEY_TOKEN, idToken);
        }
      }
      sessionStorage.removeItem(KEY_NONCE);
      if (msg) sessionStorage.setItem(KEY_ERR, msg);
    } catch (e) { /* ignore */ }

    navigate(back, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        background: "linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)",
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center"
      }}
    >
      <div className="text-center text-white">
        <div className="spinner-border text-light mb-3" role="status"></div>
        <div>Completing Google sign-in...</div>
      </div>
    </div>
  );
}