/**
 * Every reason a recording session may stop, and the state needed to decide.
 *
 * One file on purpose. Nine signals spread across three execution contexts (the
 * user's tab, the bot's tab, the service worker) is exactly the shape of thing
 * that rots into "which of these actually fires?" — so the reasons, the
 * thresholds and the decision logic all live here, and the entrypoints only
 * feed it facts.
 *
 * Pure TypeScript: no `chrome.*`, no DOM, no timers. That is what makes the
 * timing rules testable without a browser or a real clock.
 *
 * The guiding rule: **fail closed**. Signals that detect an event (a tab
 * closing, a URL changing) can be missed, and missing one means we keep
 * recording a meeting the user has left. So the event signals are treated as
 * fast paths only, and the guarantee comes from liveness — the user's tab must
 * keep proving it is still in the call, and silence stops the recording.
 */

/* ------------------------------------------------------------------ *
 * Reasons
 * ------------------------------------------------------------------ */

/**
 * Signals that are known the instant they happen. Each corresponds to an
 * observable event in one of the three contexts.
 */
export type ImmediateStopReason =
  /** 1. The user's tab routed away from /xxx-yyyy-zzz — they left the call. */
  | 'user-left-meeting'
  /** 2. pagehide on the user's tab. */
  | 'user-tab-hidden'
  /** 3. The user's tab or the bot's tab was closed. */
  | 'tab-closed'
  /** 4. pagehide on the bot's tab. */
  | 'bot-tab-hidden'
  /** 7. The bot is no longer in the call — removed by the host, or it ended. */
  | 'bot-not-in-call'
  /** 8. The user pressed Stop. */
  | 'manual-stop';

/**
 * Signals derived from the passage of time. These are the ones that fail
 * closed, and the reason the session is guaranteed to end even when every
 * immediate signal is missed.
 */
export type TimedStopReason =
  /** 5+6. The user's tab stopped proving it is still in the call. */
  | 'heartbeat-lost'
  /** 9. Capture is attached but no new captions have arrived in a long time. */
  | 'capture-stalled';

export type StopReason = ImmediateStopReason | TimedStopReason;

export interface StopDecision {
  readonly reason: StopReason;
  /** Human-readable, surfaced in notifications and the meetings list. */
  readonly detail: string;
}

/** Whether a stop was the expected end of a meeting or something going wrong. */
export function isCleanStop(reason: StopReason): boolean {
  return reason !== 'capture-stalled';
}

/* ------------------------------------------------------------------ *
 * Thresholds
 * ------------------------------------------------------------------ */

/** How often the user's tab announces it is still in the call. */
export const HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * Silence after which we assume the user is gone. Four missed beats: long
 * enough to ride out a stalled service worker or a busy tab, short enough that
 * nothing records for long without a user.
 */
export const HEARTBEAT_TIMEOUT_MS = 45_000;

/**
 * Grace before the first heartbeat is expected. The bot tab is created, joins,
 * and enables captions before capture begins, and the user's tab may not have
 * reported in yet.
 */
export const HEARTBEAT_GRACE_MS = 90_000;

/** Captions attached but silent for this long — treat capture as broken. */
export const CAPTURE_STALL_MS = 300_000;

/** How often the watchdog should call check(). */
export const WATCHDOG_TICK_MS = 30_000;

export interface StopThresholds {
  readonly heartbeatTimeoutMs: number;
  readonly heartbeatGraceMs: number;
  readonly captureStallMs: number;
}

export const DEFAULT_THRESHOLDS: StopThresholds = {
  heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
  heartbeatGraceMs: HEARTBEAT_GRACE_MS,
  captureStallMs: CAPTURE_STALL_MS,
};

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

export interface StopWatchState {
  readonly sessionId: string;
  readonly startedAt: number;
  /** Last time the user's tab proved it was in the call. */
  readonly lastHeartbeatAt: number | null;
  /** When capture actually attached. Null until then. */
  readonly captureStartedAt: number | null;
  /** Last time a caption segment arrived. */
  readonly lastSegmentAt: number | null;
  /** Set once a decision has been returned, so nothing fires twice. */
  readonly stoppedBy: StopReason | null;
}

const DETAIL: Record<StopReason, string> = {
  'user-left-meeting': 'you left the meeting',
  'user-tab-hidden': 'the meeting tab was closed',
  'tab-closed': 'the meeting tab was closed',
  'bot-tab-hidden': 'the notetaker tab was closed',
  'bot-not-in-call': 'the notetaker was removed from the meeting',
  'manual-stop': 'you stopped the notetaker',
  'heartbeat-lost': 'lost contact with your meeting tab',
  'capture-stalled': 'captions stopped arriving',
};

/**
 * Tracks the stop signals for a single session.
 *
 * Serialisable via toJSON/fromJSON because an MV3 service worker is terminated
 * after ~30s idle and would otherwise forget when it last heard a heartbeat —
 * which would make the watchdog fire spuriously on every wake, or never.
 */
export class SessionStopWatch {
  private state: StopWatchState;

  constructor(
    state: StopWatchState,
    private readonly thresholds: StopThresholds = DEFAULT_THRESHOLDS,
  ) {
    this.state = state;
  }

  static start(
    sessionId: string,
    now: number,
    thresholds: StopThresholds = DEFAULT_THRESHOLDS,
  ): SessionStopWatch {
    return new SessionStopWatch(
      {
        sessionId,
        startedAt: now,
        lastHeartbeatAt: null,
        captureStartedAt: null,
        lastSegmentAt: null,
        stoppedBy: null,
      },
      thresholds,
    );
  }

  static fromJSON(raw: unknown, thresholds: StopThresholds = DEFAULT_THRESHOLDS): SessionStopWatch {
    return new SessionStopWatch(raw as StopWatchState, thresholds);
  }

  toJSON(): StopWatchState {
    return this.state;
  }

  get sessionId(): string {
    return this.state.sessionId;
  }

  get stopped(): boolean {
    return this.state.stoppedBy !== null;
  }

  /* -------------------------------------------------------------- *
   * Liveness inputs
   * -------------------------------------------------------------- */

  /** Signal 5: the user's tab is still in the call. */
  heartbeat(now: number): void {
    this.state = { ...this.state, lastHeartbeatAt: now };
  }

  /** Capture attached — from here on, silence is suspicious. */
  captureStarted(now: number): void {
    this.state = { ...this.state, captureStartedAt: now, lastSegmentAt: now };
  }

  /** Caption segments arrived. */
  segments(now: number): void {
    this.state = { ...this.state, lastSegmentAt: now };
  }

  /* -------------------------------------------------------------- *
   * Decisions
   * -------------------------------------------------------------- */

  /**
   * Signals 1, 2, 3, 4, 7, 8. Returns the decision to act on, or null if this
   * session has already stopped — every signal converges here, and several can
   * legitimately fire for the same session, so idempotency is the point.
   */
  signal(reason: ImmediateStopReason): StopDecision | null {
    return this.stop(reason);
  }

  /** The single transition. Everything that ends a session goes through here. */
  private stop(reason: StopReason): StopDecision | null {
    if (this.stopped) return null;
    this.state = { ...this.state, stoppedBy: reason };
    return { reason, detail: DETAIL[reason] };
  }

  /**
   * Signals 6 and 9. Called on the watchdog tick.
   *
   * Heartbeat is checked first: a session whose user has gone should be
   * reported as such even if capture also happens to have stalled, because
   * "you left" is the expected outcome and "captions stopped" is a fault.
   */
  check(now: number): StopDecision | null {
    if (this.stopped) return null;

    // 6. Heartbeat lost. Before the first heartbeat we measure from the start
    //    of the session and allow a longer grace, because the bot has to join
    //    and enable captions before anything is expected to be steady.
    const since = this.state.lastHeartbeatAt ?? this.state.startedAt;
    const budget =
      this.state.lastHeartbeatAt === null
        ? this.thresholds.heartbeatGraceMs
        : this.thresholds.heartbeatTimeoutMs;

    if (now - since > budget) {
      return this.stop('heartbeat-lost');
    }

    // 9. Capture stalled. Only meaningful once capture has actually attached —
    //    before that there is nothing to be stalled.
    if (this.state.captureStartedAt !== null && this.state.lastSegmentAt !== null) {
      if (now - this.state.lastSegmentAt > this.thresholds.captureStallMs) {
        return this.stop('capture-stalled');
      }
    }

    return null;
  }
}
