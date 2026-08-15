/**
 * Getting into a Google Meet call with the microphone and camera off.
 *
 * Pure DOM — no `chrome.*`, no extension APIs — so it runs unchanged in a
 * content script, in happy-dom under Vitest, or under Puppeteer.
 *
 * This file owns the control resolver and every control spec, including the
 * captions one. `captions.ts` imports from here rather than the other way
 * round: `isInCall()` needs the captions control as evidence, and pointing the
 * dependency the other way would make the two files circular.
 *
 * NOTE: `resolve.ts` and `selectors.ts` in this same folder hold an older,
 * separate copy of the resolver and the control specs, used by
 * MeetJoinAutomation and MeetCaptionScraper. The two sets are independent —
 * editing one does not affect the other. Consolidate before this drifts.
 */

/* ------------------------------------------------------------------ *
 * Control resolution
 * ------------------------------------------------------------------ */

/**
 * Google reflows this DOM without notice, so no single selector survives. We
 * try several independent signals in order of durability and report which one
 * matched — falling through to a weaker layer is an early warning that Google
 * shipped a change, visible before joining actually breaks.
 *
 * Order matters, and it is the opposite of what feels natural:
 *
 *   jsname  Google's internal component id. Not localised, tied to component
 *           identity rather than styling, so it outlives CSS churn.
 *   icon    Material Symbols ligature text ("mic", "call_end"). Not localised —
 *           the glyph name is the same in every language.
 *   aria    aria-label regex. Readable and fairly stable, but LOCALISED: this
 *           layer fails outright on a non-English Meet UI.
 *   text    Visible label. Also localised, and the most cosmetic. Last resort.
 *   css     Class names. Accurate today, rotate tomorrow.
 */
export type MatchStrategy = 'jsname' | 'icon' | 'aria' | 'text' | 'css';

export const STRATEGY_ORDER: readonly MatchStrategy[] = [
  'jsname',
  'icon',
  'aria',
  'text',
  'css',
];

export interface ControlSpec {
  /** Values for the jsname attribute, most likely first. */
  readonly jsname?: readonly string[];
  /** Material icon ligature names appearing inside the control. */
  readonly icon?: readonly string[];
  /** Matched against aria-label. Localised — English UIs only. */
  readonly aria?: RegExp;
  /** Lowercased visible labels, most specific first. Localised. */
  readonly text?: readonly string[];
  /** Raw CSS fallback. */
  readonly css?: string;
}

export interface Resolved {
  readonly el: HTMLElement;
  readonly matchedBy: MatchStrategy;
}

const ICON_NODE = '[aria-hidden="true"], i, .google-symbols, .notranslate';

/** Visible label with Material icon ligatures stripped out. */
export function visibleLabel(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(ICON_NODE).forEach((n) => n.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Icon ligature names present inside a control, e.g. ["mic"]. */
export function iconNames(el: Element): string[] {
  return Array.from(el.querySelectorAll(ICON_NODE))
    .map((n) => (n.textContent ?? '').trim().toLowerCase())
    .filter((t) => t !== '' && /^[a-z0-9_]+$/.test(t));
}

function clickable(doc: Document): HTMLElement[] {
  const all = Array.from(doc.querySelectorAll<HTMLElement>('button, [role="button"]')).filter(
    (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true',
  );
  // Innermost only. Meet nests controls inside wrapper divs whose textContent
  // includes the inner label, so a naive match lands on a wrapper and the click
  // silently does nothing.
  return all.filter((el) => !all.some((other) => other !== el && el.contains(other)));
}

export function resolveControl(doc: Document, spec: ControlSpec): Resolved | null {
  const candidates = clickable(doc);

  for (const strategy of STRATEGY_ORDER) {
    let el: HTMLElement | undefined;

    switch (strategy) {
      case 'jsname':
        for (const name of spec.jsname ?? []) {
          el = candidates.find((c) => c.getAttribute('jsname') === name);
          if (el) break;
        }
        break;

      case 'icon':
        for (const name of spec.icon ?? []) {
          el = candidates.find((c) => iconNames(c).includes(name));
          if (el) break;
        }
        break;

      case 'aria':
        if (spec.aria) {
          const re = spec.aria;
          el = candidates.find((c) => re.test(c.getAttribute('aria-label') ?? ''));
        }
        break;

      case 'text':
        for (const wanted of spec.text ?? []) {
          el =
            candidates.find((c) => visibleLabel(c) === wanted) ??
            candidates.find((c) => visibleLabel(c).startsWith(wanted));
          if (el) break;
        }
        break;

      case 'css':
        if (spec.css) el = doc.querySelector<HTMLElement>(spec.css) ?? undefined;
        break;
    }

    if (el) return { el, matchedBy: strategy };
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * Control specs
 * ------------------------------------------------------------------ */

export interface MeetControls {
  readonly mic: ControlSpec;
  readonly camera: ControlSpec;
  readonly captions: ControlSpec;
  readonly leave: ControlSpec;
  readonly join: ControlSpec;
}

/**
 * jsname and icon values were read off a live Meet session and are
 * language-independent; aria and text are English-only fallbacks. Prefer adding
 * a jsname or icon over another aria regex — the first two survive both CSS
 * churn and non-English UIs.
 */
export const MEET_CONTROLS: MeetControls = {
  mic: {
    jsname: ['hw0c9'],
    icon: ['mic', 'mic_off'],
    aria: /microphone/i,
  },
  camera: {
    jsname: ['psRWwc'],
    icon: ['videocam', 'videocam_off'],
    aria: /camera/i,
  },
  captions: {
    jsname: ['RrG0hf'],
    icon: ['closed_caption', 'closed_caption_off', 'closed_caption_disabled'],
    // "caption settings" must not match, hence the plural.
    aria: /captions/i,
  },
  // "Leave call" exists only once you are actually in the meeting — not on the
  // pre-join screen and not while waiting for admission. Together with the
  // captions control it is the evidence isInCall() relies on.
  leave: {
    jsname: ['CQylAd'],
    icon: ['call_end'],
    aria: /leave call/i,
  },
  join: {
    // The join button carries no stable jsname or icon — text is all there is,
    // so this one control is genuinely English-only. clickJoin() falls back to
    // pressing Enter, which Meet treats as "join" in any language.
    text: ['join now', 'ask to join', 'join anyway', 'join meeting', 'join'],
    aria: /^(join now|ask to join)/i,
  },
};

/** Detected rather than clicked. */
export const LOBBY_INDICATOR = '[data-lobby], [aria-label*="Asking to join" i]';

/* ------------------------------------------------------------------ *
 * Join automation
 * ------------------------------------------------------------------ */

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

/** Participant tiles rendered in the call. */
export const PARTICIPANT_TILE = '[data-participant-id]';

/**
 * How many participant tiles are on screen.
 *
 * ONLY safe once already in the call — use it for the idle backstop, never to
 * decide whether we are in the call. A self-preview tile carrying
 * data-participant-id exists on the pre-join screen and while awaiting
 * admission, so a non-zero count proves nothing about being admitted. That is
 * what `isInCall()` is for.
 */
export function participantCount(doc: Document): number {
  return doc.querySelectorAll(PARTICIPANT_TILE).length;
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
  readonly sleep?: (ms: number) => Promise<void>;
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
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
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
