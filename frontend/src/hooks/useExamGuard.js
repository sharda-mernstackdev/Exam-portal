import { useCallback, useEffect, useRef, useState } from "react";

function isFs() {
  return !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.msFullscreenElement
  );
}

function lockKeys() {
  try {
    if (navigator.keyboard && navigator.keyboard.lock) {
      const r = navigator.keyboard.lock(["Escape", "F11"]);
      if (r && r.catch) r.catch(() => {});
    }
  } catch (e) { /* ignore */ }
}

function unlockKeys() {
  try {
    if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock();
  } catch (e) { /* ignore */ }
}

/*
 * useExamGuard(active, onExit)
 * -------------------------------------------------------------------------
 * The old vanilla version ran every exam page inside an <iframe> (portal.html)
 * purely so that navigating from login -> instructions -> dashboard didn't
 * lose fullscreen (each was a full top-level page load, which always exits
 * fullscreen). In this React app all of those are just routes inside one
 * single-page app, so the browser never actually leaves the document, and
 * fullscreen state persists across navigation automatically — no iframe
 * shell needed.
 *
 * Pass `active = true` on every page that should be locked down (login,
 * instructions, dashboard, second-level-exam). Pass `active = false` on
 * summary.html's equivalent so the candidate can be released back to a
 * normal window.
 *
 * `onExit` (optional) fires whenever an ACTIVE page transitions from
 * fullscreen -> not fullscreen — i.e. the student used the browser's own
 * exit-fullscreen control (which no website can hide or suppress). Pages
 * use this to treat leaving fullscreen as a proctoring violation, the same
 * way tab-switching is treated.
 */
export function useExamGuard(active, onExit) {
  const [fullscreen, setFullscreen] = useState(isFs());
  const wasFsRef = useRef(isFs());

  const enter = useCallback(() => {
    const el = document.documentElement;
    try {
      const p =
        (el.requestFullscreen && el.requestFullscreen({ navigationUI: "hide" })) ||
        (el.webkitRequestFullscreen && el.webkitRequestFullscreen()) ||
        (el.msRequestFullscreen && el.msRequestFullscreen());
      if (p && p.then) p.then(lockKeys).catch(() => {});
      else setTimeout(lockKeys, 200);
    } catch (e) { /* ignore */ }
  }, []);

  const exit = useCallback(() => {
    unlockKeys();
    const fn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (fn && isFs()) {
      try {
        const r = fn.call(document);
        if (r && r.catch) r.catch(() => {});
      } catch (e) { /* ignore */ }
    }
  }, []);

  // Track fullscreen state, and fire onExit whenever an ACTIVE (locked) page
  // transitions from fullscreen -> not fullscreen (i.e. the student used the
  // browser's own exit-fullscreen control, which no website can hide).
  useEffect(() => {
    function sync() {
      const nowFs = isFs();
      if (active && wasFsRef.current && !nowFs && onExit) onExit();
      wasFsRef.current = nowFs;
      setFullscreen(nowFs);
      if (nowFs) lockKeys();
    }
    const events = ["fullscreenchange", "webkitfullscreenchange", "msfullscreenchange"];
    events.forEach((evt) => document.addEventListener(evt, sync));
    return () => events.forEach((evt) => document.removeEventListener(evt, sync));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Keyboard / context-menu / history guards — only while this page wants
  // the lock enforced.
  useEffect(() => {
    if (!active) return undefined;

    function keyGuard(e) {
      const k = e.key;
      // IMPORTANT: on `keypress` events the browser puts the typed CHARACTER's
      // code in keyCode ('{' = 123, 'z' = 122), which is the same number as the
      // F12 / F11 key codes. Only real key events (keydown / keyup) may be
      // judged by keyCode, otherwise typing '{' or 'z' is wrongly blocked.
      const kc = e.type === "keypress" ? 0 : e.keyCode;
      // AltGr (used for { [ ] } \ @ etc. on many keyboard layouts) is reported
      // by Windows as Ctrl+Alt, so it must not be mistaken for a Ctrl shortcut.
      const altGr = !!(e.getModifierState && e.getModifierState("AltGraph"));
      const tag = (e.target && e.target.tagName) || "";
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable);
      const block =
        k === "Escape" || k === "Esc" || kc === 27 ||
        k === "F11" || kc === 122 ||
        k === "F12" || kc === 123 || // F12
        (e.altKey && (k === "ArrowLeft" || k === "ArrowRight")) ||
        (e.altKey && k === "Tab") ||
        (!altGr && e.ctrlKey && e.shiftKey && (kc === 73 || kc === 74 || kc === 67)) ||
        (!altGr && e.ctrlKey && (kc === 85 || kc === 82 || kc === 87 ||
                                 kc === 78 || kc === 84 || kc === 80)) ||
        (k === "Backspace" && !typing);
      if (block) {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        return false;
      }
    }

    function ctxGuard(e) {
      e.preventDefault();
    }

    function trapHistory() {
      try {
        window.history.pushState({ exam: 1 }, "", window.location.href);
      } catch (e) { /* ignore */ }
    }
    trapHistory();

    function onPopState() {
      trapHistory();
      if (!isFs()) enter();
    }

    function onVisibility() {
      if (!document.hidden && !isFs()) setTimeout(enter, 60);
    }

    function onFocus() {
      if (!isFs()) enter();
    }

    const keyEvents = ["keydown", "keyup", "keypress"];
    keyEvents.forEach((evt) => window.addEventListener(evt, keyGuard, true));
    document.addEventListener("contextmenu", ctxGuard);
    window.addEventListener("popstate", onPopState);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    return () => {
      keyEvents.forEach((evt) => window.removeEventListener(evt, keyGuard, true));
      document.removeEventListener("contextmenu", ctxGuard);
      window.removeEventListener("popstate", onPopState);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [active, enter]);

  return { fullscreen, enter, exit };
}