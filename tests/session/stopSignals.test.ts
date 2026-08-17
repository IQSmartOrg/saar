import { describe, it, expect } from 'vitest';
import {
  SessionStopWatch,
  isCleanStop,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  HEARTBEAT_GRACE_MS,
  CAPTURE_STALL_MS,
  type ImmediateStopReason,
} from '@/session/stopSignals';

const T0 = 1_000_000;
const watch = (): SessionStopWatch => SessionStopWatch.start('sess-1', T0);

describe('immediate signals (1,2,3,4,7,8)', () => {
  const reasons: ImmediateStopReason[] = [
    'user-left-meeting',
    'user-tab-hidden',
    'tab-closed',
    'bot-tab-hidden',
    'bot-not-in-call',
    'manual-stop',
  ];

  it.each(reasons)('%s stops the session and explains itself', (reason) => {
    const w = watch();
    const d = w.signal(reason);
    expect(d?.reason).toBe(reason);
    expect(d?.detail).toBeTruthy();
    expect(w.stopped).toBe(true);
  });

  it('is idempotent — the second signal returns null', () => {
    // Several signals legitimately fire for one session: the user leaves, the
    // tab closes, the bot notices. Only the first may end it.
    const w = watch();
    expect(w.signal('user-left-meeting')).not.toBeNull();
    expect(w.signal('tab-closed')).toBeNull();
    expect(w.signal('manual-stop')).toBeNull();
  });

  it('stops a stopped session from being revived by check()', () => {
    const w = watch();
    w.signal('manual-stop');
    expect(w.check(T0 + HEARTBEAT_GRACE_MS + 1)).toBeNull();
  });
});

describe('signal 6 — heartbeat lost', () => {
  it('does not fire while heartbeats keep arriving', () => {
    const w = watch();
    let now = T0;
    for (let i = 0; i < 50; i++) {
      now += HEARTBEAT_INTERVAL_MS;
      w.heartbeat(now);
      expect(w.check(now)).toBeNull();
    }
  });

  it('tolerates a few missed beats', () => {
    const w = watch();
    w.heartbeat(T0);
    expect(w.check(T0 + HEARTBEAT_TIMEOUT_MS - 1)).toBeNull();
  });

  it('fires once the silence exceeds the timeout', () => {
    const w = watch();
    w.heartbeat(T0);
    const d = w.check(T0 + HEARTBEAT_TIMEOUT_MS + 1);
    expect(d?.reason).toBe('heartbeat-lost');
  });

  it('allows a longer grace before the FIRST heartbeat', () => {
    // The bot has to join and enable captions before anything is steady;
    // failing at the normal timeout would kill every session at startup.
    const w = watch();
    expect(w.check(T0 + HEARTBEAT_TIMEOUT_MS + 1)).toBeNull();
    expect(w.check(T0 + HEARTBEAT_GRACE_MS - 1)).toBeNull();
    expect(w.check(T0 + HEARTBEAT_GRACE_MS + 1)?.reason).toBe('heartbeat-lost');
  });

  it('switches from grace to the normal timeout once a beat arrives', () => {
    const w = watch();
    w.heartbeat(T0 + 1000);
    // Grace no longer applies: the shorter timeout governs from here.
    expect(w.check(T0 + 1000 + HEARTBEAT_TIMEOUT_MS + 1)?.reason).toBe('heartbeat-lost');
  });
});

describe('signal 9 — capture stalled', () => {
  it('does nothing before capture has attached', () => {
    // Nothing can be stalled if it never started.
    const w = watch();
    w.heartbeat(T0 + CAPTURE_STALL_MS * 2);
    expect(w.check(T0 + CAPTURE_STALL_MS * 2)).toBeNull();
  });

  it('fires when captions dry up for too long', () => {
    const w = watch();
    w.captureStarted(T0);
    let now = T0;
    // Keep the user present so this is unambiguously the stall signal.
    for (let i = 0; i < 40; i++) {
      now += 10_000;
      w.heartbeat(now);
    }
    expect(now - T0).toBeGreaterThan(CAPTURE_STALL_MS);
    expect(w.check(now)?.reason).toBe('capture-stalled');
  });

  it('is reset by arriving segments', () => {
    const w = watch();
    w.captureStarted(T0);
    let now = T0;
    for (let i = 0; i < 40; i++) {
      now += 10_000;
      w.heartbeat(now);
      w.segments(now);
      expect(w.check(now)).toBeNull();
    }
  });

  it('reports heartbeat loss ahead of a stall when both are true', () => {
    // "You left" is the expected outcome; "captions stopped" is a fault. The
    // user should be told the ordinary thing, not the alarming one.
    const w = watch();
    w.captureStarted(T0);
    w.heartbeat(T0);
    const late = T0 + CAPTURE_STALL_MS + HEARTBEAT_TIMEOUT_MS + 1;
    expect(w.check(late)?.reason).toBe('heartbeat-lost');
  });
});

describe('clean vs faulty stops', () => {
  it('treats every ordinary ending as clean', () => {
    for (const r of [
      'user-left-meeting',
      'user-tab-hidden',
      'tab-closed',
      'bot-tab-hidden',
      'bot-not-in-call',
      'manual-stop',
      'heartbeat-lost',
    ] as const) {
      expect(isCleanStop(r)).toBe(true);
    }
  });

  it('treats a stall as a fault, so it cannot read as a finished meeting', () => {
    expect(isCleanStop('capture-stalled')).toBe(false);
  });
});

describe('survives service-worker termination', () => {
  it('round-trips through JSON without losing liveness state', () => {
    // MV3 kills the worker after ~30s idle. If lastHeartbeatAt did not survive,
    // the watchdog would either fire immediately on every wake or never at all.
    const w = watch();
    w.captureStarted(T0);
    w.heartbeat(T0 + 5000);
    w.segments(T0 + 6000);

    const revived = SessionStopWatch.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));

    expect(revived.sessionId).toBe('sess-1');
    expect(revived.stopped).toBe(false);
    expect(revived.check(T0 + 5000 + HEARTBEAT_TIMEOUT_MS - 1)).toBeNull();
    expect(revived.check(T0 + 5000 + HEARTBEAT_TIMEOUT_MS + 1)?.reason).toBe('heartbeat-lost');
  });

  it('carries the stopped flag across a restart', () => {
    const w = watch();
    w.signal('manual-stop');
    const revived = SessionStopWatch.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
    expect(revived.stopped).toBe(true);
    expect(revived.signal('tab-closed')).toBeNull();
  });
});
