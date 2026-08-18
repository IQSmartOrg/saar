/**
 * Making Meet keep rendering while its tab is hidden.
 *
 * Chrome does not schedule `requestAnimationFrame` for a hidden tab and reports
 * `document.hidden === true`. Meet is a rAF-driven UI that also consults the
 * Page Visibility API, so in a hidden tab it renders its initial HTML and then
 * stops: the media controls never appear, so the bot cannot confirm a mute and
 * will not join, and the caption region is never mutated, so the scraper's
 * MutationObserver never fires. Measured directly — the notetaker reported
 * `visibility=hidden | mic:none camera:none | join:text`.
 *
 * "Hidden" is broader than minimized. Chrome's occlusion tracking counts a
 * window entirely covered by another as hidden too, which is why giving the
 * notetaker its own unfocused window did not help: it opened behind a maximized
 * Chrome and was occluded immediately.
 *
 * Two separate problems, two separate fixes, and both are needed:
 *
 *   1. Meet's own checks. Overriding `document.hidden` and `visibilityState`
 *      makes them pass.
 *   2. Frame scheduling. That is the browser's decision and it ignores the
 *      property above, so rAF is backed by a timer when genuinely hidden.
 *
 * Timers survive: Chrome's intensive throttling (one wake-up per minute)
 * requires a page to be hidden over 5 minutes AND silent AND *not using
 * WebRTC*. A call in progress holds a live RTCPeerConnection, so an in-call tab
 * is exempt regardless of the tab being muted.
 *
 * This runs in the MAIN world at document_start — it has to replace these
 * before Meet's own code captures them. The extension's other content scripts
 * stay in the isolated world, where `document.visibilityState` still reports
 * the truth, which is what keeps the diagnostic honest.
 */

/** Roughly 60fps. Chrome will not honour it exactly while hidden; near enough. */
const FRAME_MS = 16;

export function keepRendering(win: Window & typeof globalThis): void {
  const doc = win.document;

  // Captured before the override, so the real state is still knowable — both
  // for deciding whether to substitute rAF, and to avoid lying to ourselves.
  const realHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden')?.get;
  const isReallyHidden = (): boolean =>
    realHidden === undefined ? false : Boolean(realHidden.call(doc));

  // 1. Tell Meet it is visible.
  try {
    Object.defineProperty(Document.prototype, 'hidden', {
      configurable: true,
      get: () => false,
    });
    Object.defineProperty(Document.prototype, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  } catch {
    /* another extension got here first; the rAF substitution still helps */
  }

  // Meet pauses work when it sees this event, and it fires on the real
  // transition regardless of the getters above.
  win.addEventListener(
    'visibilitychange',
    (e) => {
      e.stopImmediatePropagation();
    },
    true,
  );

  // Some code paths ask this instead.
  doc.hasFocus = () => true;

  // 2. Keep frames coming. Delegated to the native scheduler whenever the tab
  //    is genuinely visible, so a foreground tab keeps real vsync-aligned
  //    animation and only a hidden one pays for the timer.
  const nativeRaf = win.requestAnimationFrame.bind(win);
  const nativeCancel = win.cancelAnimationFrame.bind(win);
  const timerIds = new Set<number>();

  win.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    if (!isReallyHidden()) return nativeRaf(cb);
    const id = win.setTimeout(() => {
      timerIds.delete(id);
      cb(win.performance.now());
    }, FRAME_MS);
    timerIds.add(id);
    return id;
  };

  win.cancelAnimationFrame = (id: number): void => {
    if (timerIds.delete(id)) win.clearTimeout(id);
    else nativeCancel(id);
  };
}
