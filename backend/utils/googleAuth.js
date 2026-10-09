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
    throw new Error('Please sign in with your Google account to register.');
  }
  const info = await fetchTokenInfo(idToken);
  if (info.aud !== clientId) throw new Error('This Google sign-in is not valid for this portal.');
  if (String(info.email_verified) !== 'true') throw new Error('Your Google email address is not verified.');
  if (!info.email) throw new Error('Google did not return an email address.');
  if (info.exp && Number(info.exp) * 1000 < Date.now()) throw new Error('Google sign-in expired. Please sign in again.');
  return { email: String(info.email).toLowerCase(), name: info.name || '' };
}

module.exports = { verifyGoogleIdToken };