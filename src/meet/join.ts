import { LOBBY_INDICATOR, MEET_CONTROLS, type MeetControls } from '@/meet/controls';
import { resolveControl, visibleLabel, type MatchStrategy } from '@/meet/resolve';
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

export interface JoinClick {
  readonly clicked: boolean;
  /** Lowercased label of the button that was clicked, for the log. */
  readonly label: string;
  /**
   * The button asked for admission rather than joining outright.
   *
   * "Ask to join" is Meet telling us up front that a host has to let us in and
   * may take minutes about it. Worth knowing at the moment of the click rather
   * than inferring it afterwards from a waiting screen we cannot reliably see.
   */
  readonly needsAdmission: boolean;
}

/** "ask to join", "ask to be let in" — admission required, in the label. */
const ASKS_FOR_ADMISSION = /\bask\b/;

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

  /**
   * The join button, if it is on the page right now.
   *
   * Public because its ABSENCE is load-bearing: once we have clicked it and it
   * is gone while we are still not in the call, we are waiting to be admitted.
   * That inference needs no selector, which matters because the waiting
   * screen's markup is the one thing here nobody has verified.
   */
  findJoin(): { el: HTMLElement; label: string } | null {
    const el = this.find('join');
    if (el === null) return null;
    const label = (visibleLabel(el) || el.getAttribute('aria-label') || '').toLowerCase();
    return { el, label };
  }

  /** Clicks join if it is there. Does nothing at all if it is not. */
  async clickJoin(): Promise<JoinClick> {
    const found = this.findJoin();
    if (found === null) return { clicked: false, label: '', needsAdmission: false };

    found.el.click();
    return {
      clicked: true,
      label: found.label,
      needsAdmission: ASKS_FOR_ADMISSION.test(found.label),
    };
  }

  /**
   * The language fallback: Meet activates the focused primary action on Enter.
   *
   * Separate from clickJoin, and used at most once by the driver. Synthetic key
   * events are usually ignored by Meet's React handlers, so this is best-effort
   * — and firing it on every poll for three minutes is ninety synthetic
   * keypresses into a live page, which is not best-effort, it is vandalism.
   */
  pressEnter(): void {
    this.doc.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
    );
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
  /** The join button said "Ask to join" — a host had to let us in. */
  readonly needsAdmission: boolean;
  readonly error?: string;
  readonly report: readonly ControlReport[];
}

export const DEFAULT_JOIN_TIMEOUT_MS = 180_000;
export const DEFAULT_JOIN_POLL_MS = 2000;

/**
 * How long to leave a click alone before deciding it did not land.
 *
 * The click that gets us in is the FIRST one; every later one is a retry for a
 * button that did not respond. Retrying on every poll is what broke "Ask to
 * join" meetings: each click withdraws and re-issues the knock, so the host's
 * "someone wants to join" prompt kept vanishing and reappearing and admission
 * never completed.
 */
export const RECLICK_AFTER_MS = 10_000;

/**
 * Runs the loop into the meeting.
 *
 * Three states, and the middle one is the whole point:
 *
 *   pre-join   the join button is on screen. Mute, and click it once the mic
 *              and camera are confirmed off.
 *   waiting    clicked, button gone, still not in the call — we are in the
 *              queue for admission. Do nothing but wait.
 *   in call    the captions or leave control exists. Done.
 *
 * "waiting" is derived from the button's disappearance rather than matched
 * against Meet's waiting-room markup. Both signals are used, but only the
 * derived one is trustworthy: the lobby selector has never been confirmed
 * against a live meeting, and when it silently fails to match, a selector-only
 * design falls back to hammering the join button.
 *
 * Because each pass re-checks isInCall(), a human clicking "Join now" or
 * accepting the admission themselves still gets us there.
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
  let needsAdmission = false;
  let lastClickAt: number | null = null;
  let pressedEnter = false;

  const enterLobby = (): void => {
    if (wasInLobby) return;
    wasInLobby = true;
    onLobby?.();
  };

  while (now() < deadline) {
    if (join.isInCall()) {
      return { ok: true, wasInLobby, needsAdmission, report: join.report() };
    }

    await join.muteMicAndCamera();

    // Meet's own waiting screen, on the occasions we can see it.
    if (join.isInLobby()) {
      enterLobby();
      await sleep(pollMs);
      continue;
    }

    const button = join.findJoin();

    if (button === null) {
      if (lastClickAt !== null) {
        // Clicked, button gone, not in the call: the waiting room, whatever it
        // looks like. Nothing to do but let the host get to us.
        enterLobby();
      } else if (!pressedEnter && join.micAndCameraConfirmedOff()) {
        // No button we recognise and we have never clicked one — the label is
        // in a language we do not carry. Once, never on a loop.
        everConfirmedOff = true;
        pressedEnter = true;
        join.pressEnter();
      }
      await sleep(pollMs);
      continue;
    }

    // The safety gate. Joining with a live microphone puts the bot audibly into
    // someone's meeting, so a click we are not certain about is worse than not
    // joining at all — we wait for the next pass instead.
    const due = lastClickAt === null || now() - lastClickAt >= RECLICK_AFTER_MS;
    if (due && join.micAndCameraConfirmedOff()) {
      everConfirmedOff = true;
      const click = await join.clickJoin();
      if (click.clicked) {
        lastClickAt = now();
        if (click.needsAdmission) {
          // The button said so itself; no need to wait and infer it.
          needsAdmission = true;
          enterLobby();
        }
      }
    }

    await sleep(pollMs);
  }

  // One final check: the last sleep may have straddled admission.
  if (join.isInCall()) {
    return { ok: true, wasInLobby, needsAdmission, report: join.report() };
  }

  const secs = Math.round(timeoutMs / 1000);
  let error: string;
  if (wasInLobby) {
    error = `the host did not admit the notetaker within ${secs}s`;
  } else if (!everConfirmedOff) {
    // Never joined because we could never prove the mic and camera were off.
    // Distinct from a plain timeout: it means the controls did not resolve, so
    // it points at Meet's DOM having changed rather than at a slow host.
    error = `refused to join: could not confirm microphone and camera were off within ${secs}s`;
  } else {
    error = `could not get into the meeting within ${secs}s`;
  }

  return { ok: false, wasInLobby, needsAdmission, error, report: join.report() };
}
