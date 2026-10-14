const https = require('https');

// Verifies a Google Sign-In ID token ("credential") with Google itself and
// returns the verified account { email, name }. Throws a short Error when the
// token is missing, expired, forged, issued for another app, or the Google
// email is not verified. Needs GOOGLE_CLIENT_ID in the backend environment.
function fetchTokenInfo(idToken) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { timeout: 8000 },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            if (res.statusCode !== 200) return reject(new Error('Google sign-in could not be verified. Please sign in again.'));
            resolve(json);
          } catch (e) {
            reject(new Error('Google sign-in could not be verified. Please try again.'));
          }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('Google verification timed out. Please try again.')); });
    req.on('error', () => reject(new Error('Could not reach Google to verify your sign-in. Please try again.')));
  });
}

async function verifyGoogleIdToken(idToken, clientId) {
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('Please sign in with your Google account to continue.');
  }
  const info = await fetchTokenInfo(idToken);
  if (info.iss && info.iss !== 'accounts.google.com' && info.iss !== 'https://accounts.google.com') throw new Error('This Google sign-in is not valid.');
  if (info.aud !== clientId) throw new Error('This Google sign-in is not valid for this portal.');
  if (String(info.email_verified) !== 'true') throw new Error('Your Google email address is not verified.');
  if (!info.email) throw new Error('Google did not return an email address.');
  if (info.exp && Number(info.exp) * 1000 < Date.now()) throw new Error('Google sign-in expired. Please sign in again.');
  return { email: String(info.email).toLowerCase(), name: info.name || '' };
}

// HARD email check for the exam links (Round 1 and Round 2).
// The person opening the link must be signed in to the Google account of the
// REGISTERED email; the email comes from Google's verified token, never from
// the link or the form. Returns null when the check passes, otherwise
// { status, body } to send back - and the caller must stop.
// It FAILS CLOSED: if GOOGLE_CLIENT_ID is not configured on the server, nobody
// gets in (before, the check was silently skipped, so a forwarded link worked).
// `what` is only used in the message ("exam" / "Round 2").
async function requireRegisteredGoogleEmail(googleToken, registeredEmail, what) {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  if (!clientId) {
    console.error('[security] GOOGLE_CLIENT_ID is not set - exam sign-in is refused. Set it in the backend .env (and VITE_GOOGLE_CLIENT_ID in the frontend).');
    return {
      status: 503,
      body: { googleError: true, message: 'Exam sign-in is not available because email verification is not set up on the server. Please contact the administrator.' }
    };
  }
  const registered = String(registeredEmail || '').trim().toLowerCase();
  try {
    const g = await verifyGoogleIdToken(googleToken, clientId);
    if (!registered || g.email !== registered) {
      return {
        status: 403,
        body: {
          googleError: true,
          message: `This ${what} link was sent to ${registeredEmail}. You are signed in as ${g.email}. Please open the link in Chrome signed in with ${registeredEmail}.`
        }
      };
    }
    return null;
  } catch (gErr) {
    return { status: 403, body: { googleError: true, message: gErr.message } };
  }
}

if (!(process.env.GOOGLE_CLIENT_ID || '').trim()) {
  console.warn('[security] GOOGLE_CLIENT_ID is not set - exam links (Round 1 and Round 2) will be REFUSED until it is set in backend .env (and VITE_GOOGLE_CLIENT_ID in the frontend).');
}

module.exports = { verifyGoogleIdToken, requireRegisteredGoogleEmail };