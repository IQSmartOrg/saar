import { LOBBY_INDICATOR, MEET_CONTROLS, type MeetControls } from '@/meet/controls';
import { resolveControl, type MatchStrategy } from '@/meet/resolve';
import { sleep as realSleep, type Sleep } from '@/utils/sleep';

/**
 * Getting into a Google Meet call with the microphone and camera off.
 *
 * Pure DOM — no `chrome.*`, no extension APIs — so it runs unchanged in a
 * content script, in happy-dom under Vitest, or under Puppeteer.
 */

export interface ControlReport {
  readonly control: string;
  readonly matchedBy: MatchStrategy | 'none';
}

/**
 * Drives Meet's pre-join controls via DOM interaction only.
 *
 * `element.click()` works on Meet's React handlers even though the synthetic
 * event is untrusted; synthetic KeyboardEvents do NOT, so keyboard shortcuts
 * are never used for controls. (The Enter fallback in clickJoin is dispatched
 * on the document and is best-effort for exactly that reason.)
 *
 * Every lookup goes through resolveControl, which reports which layer matched.
 * `report()` surfaces that so drift toward the weaker layers is visible before
 * anything actually breaks.
 */
export class MeetJoin {
  private matches = new Map<string, MatchStrategy | 'none'>();

  constructor(
    private readonly doc: Document,
    private readonly controls: MeetControls = MEET_CONTROLS,
    private readonly lobbyIndicator: string = LOBBY_INDICATOR,
  ) {}

  private find(name: keyof MeetControls): HTMLElement | null {
    const hit = resolveControl(this.doc, this.controls[name]);
    this.matches.set(name, hit?.matchedBy ?? 'none');
    return hit?.el ?? null;
  }

  /** Which strategy matched each control the last time it was looked up. */
  report(): readonly ControlReport[] {
    return [...this.matches].map(([control, matchedBy]) => ({ control, matchedBy }));
  }

  /** True when a toggle is already in the "off" state. */
  private isOff(el: Element): boolean {
    const muted = el.getAttribute('data-is-muted');
    if (muted !== null) return muted === 'true';
    // "Turn on X" means X is currently off. English-only, hence the attribute
    // check first.
    return /turn on/i.test(el.getAttribute('aria-label') ?? '');
  }

  /**
   * Microphone and camera off. Never re-clicks a control that is already off —
   * that would switch it back on and put the bot live in the meeting.
   */
  async muteMicAndCamera(): Promise<void> {
    for (const name of ['mic', 'camera'] as const) {
      const el = this.find(name);
      if (el && !this.isOff(el)) el.click();
    }
  }

  /**
   * True only when BOTH controls are present AND read as off.
   *
   * A missing control counts as NOT off. On the first pass the pre-join screen
   * may not have rendered its control bar yet, so muteMicAndCamera() finds
   * nothing, silently does nothing, and reports nothing — which is exactly how
   * the bot used to walk into meetings live. Anything that joins must gate on
   * this rather than on muteMicAndCamera() having been called.
   *
   * Meet re-renders asynchronously after a click, so a control clicked this
   * pass usually still reads "on" until the next one. That is intended: the
   * caller polls, and one extra cycle of latency is the price of certainty.
   */
  micAndCameraConfirmedOff(): boolean {
    for (const name of ['mic', 'camera'] as const) {
      const el = this.find(name);
      if (el === null || !this.isOff(el)) return false;
    }
    return true;
  }

  async clickJoin(): Promise<boolean> {
    const btn = this.find('join');
    if (btn) {
      btn.click();
      return true;
    }

    // Nothing matched — the label is probably in a language we do not carry.
    // Meet activates the focused primary action on Enter, so this is the one
    // language-independent way in. Best-effort: untrusted key events are often
    // ignored, which is why it is a fallback and not the primary path.
    this.doc.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
    );
    return false;
  }

  isInLobby(): boolean {
    return this.doc.querySelector(this.lobbyIndicator) !== null;
  }

  /**
   * True once we are actually inside the call, rather than on the pre-join
   * screen or in the lobby. The captions and leave controls only exist in-call,
   * so either is sufficient evidence.
   *
   * Deliberately NOT a participant-tile count: a self-preview tile carrying
   * data-participant-id exists on the pre-join screen and while waiting to be
   * admitted. Treating that as "in the call" made an earlier version race ahead
   * and burn every caption retry ~25s before the CC button appeared.
   *
   * This is also what lets a human click "Join now" themselves when clickJoin()
   * cannot find the button — the driver waits until it observes that it is in
   * the meeting, however that happened.
   */
  isInCall(): boolean {
    if (this.isInLobby()) return false;
    return this.find('captions') !== null || this.find('leave') !== null;
  }
}

/**
 * Read-only check for whether *this* tab is inside a call.
 *
 * Standalone because the user's own tab needs it too: a Meet URL matches
 * `/xxx-yyyy-zzz` while the pre-join screen is still showing, so the URL alone
 * cannot tell "about to join" from "joined". Touches nothing on the page, so it
 * is safe to run on a tab we do not own.
 */
export function isInCall(doc: Document): boolean {
  return new MeetJoin(doc).isInCall();
}

/* ------------------------------------------------------------------ *
 * Driver
 * ------------------------------------------------------------------ */

export interface JoinOptions {
  /**
   * One patient budget covering the whole path in — pre-join screen, clicking
   * join, and waiting in the lobby to be admitted — rather than separate short
   * ones, so a human clicking "Join now" manually still works.
   */
  readonly timeoutMs?: number;
  readonly pollMs?: number;
  readonly onLobby?: () => void;
  readonly sleep?: Sleep;
  readonly now?: () => number;
}

export interface JoinOutcome {
  readonly ok: boolean;
  /** True if we were ever observed waiting for admission. */
  readonly wasInLobby: boolean;
  readonly error?: string;
  readonly report: readonly ControlReport[];
}

export const DEFAULT_JOIN_TIMEOUT_MS = 180_000;
export const DEFAULT_JOIN_POLL_MS = 2000;

/**
 * Runs the loop into the meeting. Each pass mutes, tries to click join, and
 * checks whether we are in yet — so if clickJoin() cannot find the button, a
 * human clicking it themselves still gets us there.
 */
export async function joinMeeting(doc: Document, opts: JoinOptions = {}): Promise<JoinOutcome> {
  const {
    timeoutMs = DEFAULT_JOIN_TIMEOUT_MS,
    pollMs = DEFAULT_JOIN_POLL_MS,
    onLobby,
    sleep = realSleep,
    now = () => Date.now(),
  } = opts;

  const join = new MeetJoin(doc);
  const deadline = now() + timeoutMs;
  let wasInLobby = false;
  let everConfirmedOff = false;

  while (now() < deadline) {
    if (join.isInCall()) {
      return { ok: true, wasInLobby, report: join.report() };
    }

    await join.muteMicAndCamera();

    if (join.isInLobby()) {
      if (!wasInLobby) {
        wasInLobby = true;
        onLobby?.();
      }
    } else if (join.micAndCameraConfirmedOff()) {
      // The safety gate. Joining with a live microphone puts the bot audibly
      // into someone's meeting, so a click we are not certain about is worse
      // than not joining at all — we wait for the next pass instead.
      everConfirmedOff = true;
      await join.clickJoin();
    }

    await sleep(pollMs);
  }

  // One final check: the last sleep may have straddled admission.
  if (join.isInCall()) {
    return { ok: true, wasInLobby, report: join.report() };
  }

  const secs = Math.round(timeoutMs / 1000);
  let error: string;
  if (wasInLobby) {
    error = `not admitted from the lobby within ${secs}s`;
  } else if (!everConfirmedOff) {
    // Never joined because we could never prove the mic and camera were off.
    // Distinct from a plain timeout: it means the controls did not resolve, so
    // it points at Meet's DOM having changed rather than at a slow host.
    error = `refused to join: could not confirm microphone and camera were off within ${secs}s`;
  } else {
    error = `could not get into the meeting within ${secs}s`;
  }

  return { ok: false, wasInLobby, error, report: join.report() };
}
