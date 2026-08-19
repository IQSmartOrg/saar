import { LOBBY_INDICATOR, MEET_CONTROLS, type MeetControls } from '@/meet/controls';
import { resolveControl, visibleLabel, type MatchStrategy } from '@/meet/resolve';
import type { Sleep } from '@/utils/sleep';
import { runStateMachine, type StateVisit } from '@/utils/stateMachine';
import { logger } from '@/utils/logger';

const log = logger('meet.join');

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

  /** For clicking. Skips controls that cannot be pressed. */
  private find(name: keyof MeetControls): HTMLElement | null {
    const hit = resolveControl(this.doc, this.controls[name]);
    this.matches.set(name, hit?.matchedBy ?? 'none');
    return hit?.el ?? null;
  }

  /**
   * For reading state. Includes controls that are disabled.
   *
   * A disabled mic button still carries `data-is-muted`, so it answers "is the
   * mic off?" perfectly well. Reading through the click filter meant that while
   * Meet was still acquiring devices — long enough to matter in the hidden tab
   * this runs in — the gate could not confirm a mute it was looking straight
   * at, and the bot silently declined to join until someone focused the tab.
   */
  private read(name: keyof MeetControls): HTMLElement | null {
    const hit = resolveControl(this.doc, this.controls[name], { includeDisabled: true });
    this.matches.set(name, hit?.matchedBy ?? 'none');
    return hit?.el ?? null;
  }

  /** Which layer matched every control right now — for diagnosing a stuck join. */
  probeAll(): readonly ControlReport[] {
    for (const name of ['mic', 'camera', 'join', 'captions', 'leave'] as const) this.read(name);
    return this.report();
  }

  /** Mute state as the page reports it, whether or not the control is pressable. */
  muteState(): { mic: boolean | null; camera: boolean | null } {
    const of = (name: 'mic' | 'camera'): boolean | null => {
      const el = this.read(name);
      return el === null ? null : this.isOff(el);
    };
    return { mic: of('mic'), camera: of('camera') };
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
      // Read through the unfiltered resolver, click through the filtered one:
      // a disabled control can be read but not pressed, and asking the wrong
      // question of it produces a null rather than an answer.
      const state = this.read(name);
      if (state !== null && this.isOff(state)) continue;
      this.find(name)?.click();
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
      const el = this.read(name);
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

  /**
   * What made isInCall() true, spelled out.
   *
   * `captions` alone is accepted as proof, which is only sound if the control
   * cannot appear before the meeting does. Logging the parts separately is what
   * lets that assumption be checked against a real meeting rather than trusted.
   */
  inCallEvidence(): Record<string, unknown> {
    return {
      captions: this.read('captions') !== null,
      leave: this.read('leave') !== null,
      participants: this.doc.querySelectorAll('[data-participant-id]').length,
      inLobby: this.isInLobby(),
    };
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

/** Everything the resolver can see right now. For diagnosing a stuck join. */
export function inspectControls(doc: Document): {
  readonly controls: readonly ControlReport[];
  readonly mute: { mic: boolean | null; camera: boolean | null };
} {
  const join = new MeetJoin(doc);
  return { controls: join.probeAll(), mute: join.muteState() };
}

/* ------------------------------------------------------------------ *
 * Driver
 * ------------------------------------------------------------------ */

export interface JoinOptions {
  /** Per-stage time budgets. Partial: anything omitted keeps its default. */
  readonly budgets?: Partial<JoinBudgets>;
  readonly pollMs?: number;
  /** Fired once, the first time we are observed queueing for admission. */
  readonly onLobby?: () => void;
  /** Every stage transition, for logging what actually happened. */
  readonly onState?: (state: JoinState) => void;
  readonly sleep?: Sleep;
  readonly now?: () => number;
}

export interface JoinOutcome {
  readonly ok: boolean;
  /** True if we were ever observed waiting for admission. */
  readonly wasInLobby: boolean;
  /** The join button said "Ask to join" — a host had to let us in. */
  readonly needsAdmission: boolean;
  /** Each stage occupied and how long it took, for diagnosing a slow join. */
  readonly visited: readonly StateVisit<JoinState>[];
  readonly error?: string;
  readonly report: readonly ControlReport[];
}

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
 * The stages of getting in, each with its own budget.
 *
 *   booting   nothing recognised yet — the page is still rendering
 *   prejoin   the join button is up; get the mic and camera off, then click
 *   waiting   clicked; queued for a host to admit us
 *   in-call   done
 *
 * Separate budgets because the stages run at different speeds. A control that
 * has not rendered in 20s is not going to — that points at Meet's DOM having
 * changed, and sitting there for three minutes tells us nothing more. A host
 * who has not pressed Admit yet may simply be talking, and deserves minutes.
 * One shared budget serves neither, and lets a slow early stage silently eat
 * the time the later one needed.
 */
export type JoinState = 'booting' | 'prejoin' | 'waiting' | 'in-call';

export interface JoinBudgets {
  readonly bootingMs: number;
  readonly prejoinMs: number;
  readonly waitingMs: number;
  /** Backstop: per-state budgets reset on re-entry, so a flapping page needs a cap. */
  readonly totalMs: number;
}

/**
 * Calibrated for the tab this actually runs in: a BACKGROUND one.
 *
 * The notetaker tab is opened with `active: false` so it never steals focus,
 * and Chrome deprioritizes rendering in hidden tabs — a heavy SPA like Meet can
 * take a minute or more to put its pre-join screen up there, where it would
 * take a couple of seconds in the foreground.
 *
 * `bootingMs` was 20s on the reasoning that a control which has not rendered in
 * 20s never will. That is true of a visible tab and false of this one: it made
 * the bot give up before Meet had drawn anything, and joining only worked if
 * someone clicked onto the tab and prompted Chrome to prioritise it. Machine
 * speed is the wrong model here — the budget has to cover a browser that has
 * deliberately been told this tab does not matter.
 *
 * The stage timings come back in `JoinOutcome.visited`, so these can be tuned
 * against what actually happens rather than what seems reasonable.
 */
export const DEFAULT_JOIN_BUDGETS: JoinBudgets = {
  bootingMs: 120_000,
  prejoinMs: 60_000,
  waitingMs: 300_000,
  // Backstop against a page that flaps between stages forever. Comfortably
  // above booting + prejoin + waiting, or it would cut a legitimate run short.
  totalMs: 600_000,
};

/**
 * Runs the stages into the meeting.
 *
 * The state is observed from the DOM on every tick, never remembered — see
 * utils/stateMachine.ts. That is what lets a human click "Join now" or accept
 * the admission themselves and have the bot simply notice, and what stops the
 * bot sitting in a stage the page left minutes ago.
 */
export async function joinMeeting(doc: Document, opts: JoinOptions = {}): Promise<JoinOutcome> {
  const {
    pollMs = DEFAULT_JOIN_POLL_MS,
    onLobby,
    onState,
    sleep,
    now = () => Date.now(),
  } = opts;
  const budgets = { ...DEFAULT_JOIN_BUDGETS, ...opts.budgets };

  const join = new MeetJoin(doc);
  log.info('getting into the meeting', { budgets });

  let wasInLobby = false;
  let everConfirmedOff = false;
  let needsAdmission = false;
  let lastClickAt: number | null = null;
  let pressedEnter = false;

  /**
   * The one piece of our own bookkeeping the observation depends on, and it is
   * a fact about an action we took rather than a guess about the page: once we
   * have clicked and the button is gone while we are still not in the call, we
   * are in the queue — whatever the waiting screen happens to look like.
   */
  const observe = (): JoinState => {
    if (join.isInCall()) return 'in-call';
    if (join.isInLobby()) return 'waiting';
    if (join.findJoin() !== null) return 'prejoin';
    return lastClickAt === null ? 'booting' : 'waiting';
  };

  const secs = (ms: number): number => Math.round(ms / 1000);

  const result = await runStateMachine<JoinState>({
    observe,
    done: ['in-call'],
    pollMs,
    totalBudgetMs: budgets.totalMs,
    ...(sleep ? { sleep } : {}),
    now,
    states: {
      booting: {
        budgetMs: budgets.bootingMs,
        onEnter: (c) => onState?.(c.state),
        onTick: async () => {
          // The controls may render before the join button does.
          await join.muteMicAndCamera();

          // No button we recognise and we have never clicked one — the label is
          // in a language we do not carry. Meet activates the focused primary
          // action on Enter. Once, never on a loop: ninety synthetic keypresses
          // into a live page is not best-effort.
          if (!pressedEnter && join.micAndCameraConfirmedOff()) {
            everConfirmedOff = true;
            pressedEnter = true;
            log.warning('no join button recognised — pressing Enter once');
            join.pressEnter();
          }
        },
        onTimeout: (c) =>
          `Meet's pre-join screen never appeared within ${secs(c.msInState)}s — its DOM may have changed`,
      },

      prejoin: {
        budgetMs: budgets.prejoinMs,
        onEnter: (c) => onState?.(c.state),
        onTick: async () => {
          await join.muteMicAndCamera();

          // The safety gate. Joining with a live microphone puts the bot audibly
          // into someone's meeting, so a click we are not certain about is worse
          // than not joining at all — we wait for the next tick instead. A
          // control clicked this tick still reads "on" until the next one, so
          // one cycle of latency here is the price of certainty.
          const due = lastClickAt === null || now() - lastClickAt >= RECLICK_AFTER_MS;
          if (!due || !join.micAndCameraConfirmedOff()) return;

          everConfirmedOff = true;
          const click = await join.clickJoin();
          if (!click.clicked) return;

          lastClickAt = now();
          log.info('clicked join', { label: click.label, needsAdmission: click.needsAdmission });
          if (click.needsAdmission) {
            // The button said so itself — no need to wait and infer it.
            needsAdmission = true;
            if (!wasInLobby) {
              wasInLobby = true;
              onLobby?.();
            }
          }
        },
        onTimeout: (c) =>
          everConfirmedOff
            ? `clicked join but never got into the meeting within ${secs(c.msInState)}s`
            : `refused to join: could not confirm microphone and camera were off within ${secs(c.msInState)}s`,
      },

      waiting: {
        budgetMs: budgets.waitingMs,
        onEnter: (c) => {
          onState?.(c.state);
          log.info('queued for admission');
          if (wasInLobby) return;
          wasInLobby = true;
          onLobby?.();
        },
        // Nothing to do but keep the mic and camera down. Deliberately no
        // clicking: re-knocking is what stopped hosts being able to admit us.
        onTick: async () => {
          await join.muteMicAndCamera();
        },
        onTimeout: (c) => `the host did not admit the notetaker within ${secs(c.msInState)}s`,
      },

      'in-call': {
        budgetMs: Number.POSITIVE_INFINITY,
        onEnter: (c) => {
          onState?.(c.state);
          // Which control convinced us. The captions control alone is currently
          // sufficient, so if it ever appears before we are really in the
          // meeting this line is where that shows up — captions present with no
          // leave control and no participants is the shape to look for.
          log.info('believed to be in the call', {
            evidence: join.inCallEvidence(),
          });
        },
        onTimeout: () => 'unreachable: in-call is a terminal state',
      },
    },
  });

  return {
    ok: result.ok,
    wasInLobby,
    needsAdmission,
    ...(result.error === undefined ? {} : { error: result.error }),
    report: join.report(),
    visited: result.visited,
  };
}
