import { ChromeTabBot } from '@/adapters/bot/ChromeTabBot';
import { IndexedDbTranscriptRepository } from '@/adapters/storage/IndexedDbTranscriptRepository';
import { ChromeSettingsStore } from '@/adapters/storage/ChromeSettingsStore';
import { SessionRegistry, type ActiveSession } from '@/core/session/sessionState';
import { newSessionId } from '@/core/types/session';
import {
  SessionStopWatch,
  WATCHDOG_TICK_MS,
  isCleanStop,
  type ImmediateStopReason,
  type StopDecision,
} from '@/core/session/stopSignals';
import {
  PORT_NAME,
  assertNever,
  type ActiveSessionSummary,
  type Message,
} from '@/shared/messaging/messages';

const STATE_KEY = 'saar:sessions';
const WATCH_KEY = 'saar:stopwatch';
const WATCHDOG_ALARM = 'saar:watchdog';

export default defineBackground(() => {
  // Composition root: the only place concrete adapters are constructed.
  const repo = new IndexedDbTranscriptRepository();
  const settings = new ChromeSettingsStore();
  const bots = new Map<string, ChromeTabBot>();

  async function loadRegistry(): Promise<SessionRegistry> {
    const raw = await chrome.storage.session.get(STATE_KEY);
    return SessionRegistry.fromJSON(raw[STATE_KEY]);
  }

  async function saveRegistry(r: SessionRegistry): Promise<void> {
    await chrome.storage.session.set({ [STATE_KEY]: r.toJSON() });
  }

  /* ---------------------------------------------------------------- *
   * Stop signals
   *
   * Every one of the nine converges here. The watches are persisted to
   * chrome.storage.session rather than held in memory because an MV3 worker is
   * terminated after ~30s idle — an in-memory lastHeartbeatAt would be lost on
   * every wake, and the watchdog would either never fire or fire immediately.
   * ---------------------------------------------------------------- */

  async function loadWatches(): Promise<Map<string, SessionStopWatch>> {
    const raw = await chrome.storage.session.get(WATCH_KEY);
    const rows = (raw[WATCH_KEY] as unknown[] | undefined) ?? [];
    const watches = rows.map((r) => SessionStopWatch.fromJSON(r));
    return new Map(watches.map((w) => [w.sessionId, w]));
  }

  async function saveWatches(m: Map<string, SessionStopWatch>): Promise<void> {
    await chrome.storage.session.set({
      [WATCH_KEY]: [...m.values()].map((w) => w.toJSON()),
    });
  }

  /** Applies a mutation to one session's watch and acts on any decision. */
  async function withWatch(
    sessionId: string,
    fn: (w: SessionStopWatch) => StopDecision | null,
  ): Promise<void> {
    const watches = await loadWatches();
    const watch = watches.get(sessionId);
    if (!watch) return;

    const decision = fn(watch);
    await saveWatches(watches);
    if (decision) await endSession(sessionId, decision);
  }

  /** Resolves a meeting code to its session, for signals that only know the code. */
  async function signalByCode(code: string, reason: ImmediateStopReason): Promise<void> {
    const reg = await loadRegistry();
    const entry = reg.byMeetingCode(code);
    if (entry) await withWatch(entry.sessionId, (w) => w.signal(reason));
  }

  async function notify(title: string, message: string): Promise<void> {
    try {
      await chrome.notifications.create({
        type: 'basic',
        iconUrl: '/icon-128.png',
        title,
        message,
      });
    } catch {
      /* notifications are best-effort */
    }
  }

  async function startSession(
    code: string,
    userTabId: number,
    title: string | null,
  ): Promise<void> {
    const reg = await loadRegistry();
    if (reg.byMeetingCode(code)) return; // idempotent

    const cfg = await settings.get();
    if (cfg.botAccountIndex === null) {
      await notify('Saar needs setup', 'Choose the notetaker Google account in the Saar popup.');
      return;
    }

    const sessionId = newSessionId();
    await repo.createSession({
      id: sessionId,
      platform: 'google-meet',
      meetingCode: code,
      title,
      startedAt: Date.now(),
      endedAt: null,
      participants: [],
      status: 'joining',
    });

    // Go through the MeetingBot port, never chrome.tabs directly — this port is
    // what PuppeteerBot replaces in the cloud build (spec §18).
    const bot = new ChromeTabBot();
    bots.set(sessionId, bot);
    const result = await bot.join({
      sessionId,
      meetingCode: code,
      accountIndex: cfg.botAccountIndex,
    });
    if (!result.ok) {
      await repo.updateSession(sessionId, { status: 'failed', error: result.error });
      bots.delete(sessionId);
      return;
    }

    const entry: ActiveSession = {
      sessionId,
      meetingCode: code,
      userTabId,
      botTabId: result.tabId ?? null,
    };
    reg.add(entry);
    await saveRegistry(reg);

    const watches = await loadWatches();
    watches.set(sessionId, SessionStopWatch.start(sessionId, Date.now()));
    await saveWatches(watches);
    await chrome.alarms.create(WATCHDOG_ALARM, {
      periodInMinutes: WATCHDOG_TICK_MS / 60_000,
    });
  }

  async function endSession(sessionId: string, decision?: StopDecision): Promise<void> {
    const reg = await loadRegistry();
    const entry = reg.bySessionId(sessionId);
    if (!entry) return; // idempotent — several signals converge here

    reg.remove(sessionId);
    await saveRegistry(reg);

    const watches = await loadWatches();
    watches.delete(sessionId);
    await saveWatches(watches);
    if (watches.size === 0) await chrome.alarms.clear(WATCHDOG_ALARM);

    // Prefer the bot's own leave(). After a service-worker restart the
    // in-memory bot is gone, so fall back to the tab id we persisted.
    const bot = bots.get(sessionId);
    if (bot) {
      await bot.leave();
    } else if (entry.botTabId !== null) {
      try {
        await chrome.tabs.remove(entry.botTabId);
      } catch {
        /* already gone */
      }
    }
    bots.delete(sessionId);

    const current = await repo.getSession(sessionId);
    const label = current?.title ?? entry.meetingCode;

    if (current?.status === 'failed') {
      // Never report a failure as a success — say what actually went wrong.
      await notify('Saar could not record this meeting', current.error ?? label);
      return;
    }

    await repo.updateSession(sessionId, { status: 'ended', endedAt: Date.now() });
    const segments = await repo.getSegments(sessionId);
    const captured = segments.filter((s) => s.final).length;

    // Say why it stopped. A session that ended because captions dried up is a
    // fault, not a finished meeting, and must not read as one.
    const why = decision ? ` — ${decision.detail}` : '';
    if (decision && !isCleanStop(decision.reason)) {
      await notify('Saar stopped early', `${label}${why} · ${captured} lines kept`);
      return;
    }
    await notify(
      captured > 0 ? 'Transcript saved' : 'Meeting ended — nothing captured',
      captured > 0 ? `${label} · ${captured} lines${why}` : `${label}${why}`,
    );
  }

  chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
    if (msg.type === 'ACTIVE_SESSIONS_QUERY') {
      void (async () => {
        const reg = await loadRegistry();
        const rows: ActiveSessionSummary[] = [];
        for (const s of reg.all()) {
          const stored = await repo.getSession(s.sessionId);
          rows.push({
            sessionId: s.sessionId,
            meetingCode: s.meetingCode,
            title: stored?.title ?? null,
            startedAt: stored?.startedAt ?? 0,
          });
        }
        sendResponse(rows);
      })();
      return true; // async response
    }

    void (async () => {
      switch (msg.type) {
        case 'MEETING_DETECTED':
          if (sender.tab?.id !== undefined) {
            await startSession(msg.meetingCode, sender.tab.id, msg.title);
          }
          break;

        // Signals 1 and 2 — the user's tab says it is done.
        case 'USER_LEFT':
          await signalByCode(msg.meetingCode, msg.reason);
          break;

        // Signal 5 — liveness.
        case 'USER_ALIVE': {
          const reg = await loadRegistry();
          const entry = reg.byMeetingCode(msg.meetingCode);
          if (entry) {
            await withWatch(entry.sessionId, (w) => {
              w.heartbeat(Date.now());
              return null;
            });
          }
          break;
        }

        // Signal 8 — Stop pressed in the popup.
        case 'STOP_REQUESTED':
          await withWatch(msg.sessionId, (w) => w.signal('manual-stop'));
          break;

        case 'JOIN_CANCELLED':
          break;
        case 'BOT_STATE':
        case 'SEGMENT_BATCH':
        case 'SOURCE_HEALTH':
        case 'BOT_PRESENCE':
          break; // these arrive over the port, not sendMessage
        default:
          assertNever(msg);
      }
    })();
    return false;
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;

    port.onMessage.addListener((msg: Message) => {
      void (async () => {
        switch (msg.type) {
          case 'SEGMENT_BATCH':
            await repo.appendSegments(msg.sessionId, msg.segments);
            // Feeds signal 9: fresh captions mean capture is alive.
            await withWatch(msg.sessionId, (w) => {
              w.segments(Date.now());
              return null;
            });
            break;

          // Signal 7 — the bot reporting whether it is still in the call.
          case 'BOT_PRESENCE':
            if (!msg.inCall) {
              await withWatch(msg.sessionId, (w) => w.signal('bot-not-in-call'));
            }
            break;

          case 'BOT_STATE':
            await repo.updateSession(msg.sessionId, {
              status: msg.status,
              ...(msg.detail === undefined ? {} : { error: msg.detail }),
            });
            if (msg.status === 'capturing') {
              await withWatch(msg.sessionId, (w) => {
                w.captureStarted(Date.now());
                return null;
              });
            }
            // Signal 4 reaches here: the bot tab tears down and reports 'ended'.
            if (msg.status === 'ended' || msg.status === 'failed') {
              await withWatch(msg.sessionId, (w) => w.signal('bot-tab-hidden'));
              await endSession(msg.sessionId);
            }
            break;
          case 'SOURCE_HEALTH':
            if (!msg.health.selectorsMatched) {
              await notify(
                'Saar: captions not detected',
                "Meet's caption DOM may have changed — the transcript will be empty.",
              );
            }
            break;
          default:
            break;
        }
      })();
    });
  });

  // Signal 3. Either tab closing ends the session.
  chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      const reg = await loadRegistry();
      const entry = reg.all().find((x) => x.userTabId === tabId || x.botTabId === tabId);
      if (entry) await withWatch(entry.sessionId, (w) => w.signal('tab-closed'));
    })();
  });

  /**
   * Signals 6 and 9 — the watchdog.
   *
   * chrome.alarms rather than setTimeout: a timer in an MV3 worker dies with
   * the worker, so the guarantee would silently evaporate exactly when it is
   * needed. Alarms survive termination and wake the worker to run this.
   */
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== WATCHDOG_ALARM) return;
    void (async () => {
      const watches = await loadWatches();
      if (watches.size === 0) {
        await chrome.alarms.clear(WATCHDOG_ALARM);
        return;
      }

      const now = Date.now();
      const due: Array<[string, StopDecision]> = [];
      for (const [id, watch] of watches) {
        const decision = watch.check(now);
        if (decision) due.push([id, decision]);
      }
      await saveWatches(watches);
      for (const [id, decision] of due) await endSession(id, decision);
    })();
  });

  // The worker may be revived after a restart with sessions still in flight.
  void (async () => {
    const watches = await loadWatches();
    if (watches.size > 0) {
      await chrome.alarms.create(WATCHDOG_ALARM, {
        periodInMinutes: WATCHDOG_TICK_MS / 60_000,
      });
    }
  })();
});
