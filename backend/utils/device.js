// Exam is allowed on a laptop / desktop computer only. Phones and tablets are
// refused (server side, from the User-Agent the browser sends). The exam
// frontend also checks this in the browser (Instructions page) so iPads that
// pretend to be a Mac are caught too.
const MOBILE_UA_RE = /Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle|PlayBook|BlackBerry|BB10|IEMobile|Opera Mini|webOS|CriOS.*Mobile|FxiOS|SM-T|Nexus 7|Nexus 9/i;

const MOBILE_BLOCK_MESSAGE =
  'This exam cannot be taken on a mobile phone or tablet. Please use a laptop or desktop computer with a webcam.';

function isMobileRequest(req) {
  const ua = String((req.headers && req.headers['user-agent']) || '');
  if (MOBILE_UA_RE.test(ua)) return true;
  // Chrome "mobile" Client Hint (sent by Chromium browsers on phones).
  const hint = String((req.headers && req.headers['sec-ch-ua-mobile']) || '');
  return hint === '?1';
}

module.exports = { isMobileRequest, MOBILE_BLOCK_MESSAGE };