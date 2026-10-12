// Laptop / desktop only. Phones and tablets are blocked for the exam.
//
// A phone can hide from a plain User-Agent check by switching the browser to
// "Desktop site", so this also looks at what the hardware reports (touch screen
// as the main input, small physical screen, legacy phone-only properties).
// A laptop with a touch screen is NOT blocked: its main pointer is the mouse.
export function isMobileDevice() {
  try {
    const ua = navigator.userAgent || "";
    if (/Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle|PlayBook|BlackBerry|IEMobile|Opera Mini|webOS/i.test(ua)) return true;
    if (navigator.userAgentData && navigator.userAgentData.mobile) return true;
    // iPad that reports itself as a Mac.
    if (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return true;
    // Only phones / tablets define window.orientation.
    if (typeof window.orientation !== "undefined") return true;
    // Finger (coarse) is the main input = phone / tablet, even in "Desktop site" mode.
    if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) return true;
    // Touch screen + phone-sized physical screen.
    if (navigator.maxTouchPoints > 0 && Math.min(window.screen.width, window.screen.height) <= 600) return true;
  } catch (e) { /* ignore */ }
  return false;
}