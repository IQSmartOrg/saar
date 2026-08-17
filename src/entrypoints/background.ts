import { ChromeTabBot } from '@/adapters/bot/ChromeTabBot';
import { IndexedDbTranscriptRepository } from '@/adapters/storage/IndexedDbTranscriptRepository';
import { ChromeSettingsStore } from '@/adapters/storage/ChromeSettingsStore';
import { JobStore } from '@/processing/JobStore';
import { OpenAiCompatibleClient } from '@/processing/OpenAiCompatibleClient';
import { MomRunner, MOM_ALARM } from '@/processing/runner';
import { progressOf } from '@/processing/MomBuilder';
import { deriveStatus, isJobRunning } from '@/processing/status';
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
  type Activity,
  type LlmProbeResult,
  type Message,
} from '@/shared/messaging/messages';

const STATE_KEY = 'saar:sessions';
const WATCH_KEY = 'saar:stopwatch';
const WATCHDOG_ALARM = 'saar:watchdog';

export default defineBackground(() => {
  // Composition root: the only place concrete adapters are constructed.
  const repo = new IndexedDbTranscriptRepository();
  const settings = new ChromeSettingsStore();
  const jobs = new JobStore();
  const bots = new Map<string, ChromeTabBot>();

  function broadcast(msg: Message): void {
    // No receiver is the normal case — the popup is usually shut.
    void chrome.runtime.sendMessage(msg).catch(() => undefined);
  }

  const mom = new MomRunner({
    repo,
    settings,
    jobs,
    notify: (title, message) => notify(title, message),
    onProgress: (sessionId, progress) =>
      broadcast({ type: 'MOM_PROGRESS', sessionId, progress }),
  });

  /** How long a finished or failed meeting stays on the Now list. */
  const RECENT_MS = 10 * 60_000;

  /**
   * Everything Saar is doing, newest first.
   *
   * Recording comes first because it is the only row that is time-critical —
   * Stop is pressed under pressure, so it must not move down the list as
   * finished meetings pile up behind it.
   */
  async function buildActivity(): Promise<Activity[]> {
    const out: Activity[] = [];
    const reg = await loadRegistry();

    for (const entry of reg.all()) {
      const session = await repo.getSession(entry.sessionId);
      const segments = await repo.getSegments(entry.sessionId);
      out.push({
        kind: 'recording',
        sessionId: entry.sessionId,
        title: session?.title ?? entry.meetingCode,
        startedAt: session?.startedAt ?? 0,
        lines: segments.filter((x) => x.final).length,
      });
    }

    for (const job of await jobs.all()) {
      if (!isJobRunning(job.phase)) continue;
      const session = await repo.getSession(job.sessionId);
      out.push({
        kind: 'processing',
        sessionId: job.sessionId,
        title: session?.title ?? session?.meetingCode ?? 'Meeting',
        progress: progressOf(job),
      });
    }

    // Recently settled meetings, so a completed run is never something the user
    // only learns about from a notification they missed.
    const cutoff = Date.now() - RECENT_MS;
    const minutesIds = new Set(await repo.listMinutesIds());
    const phases = new Map((await jobs.all()).map((j) => [j.sessionId, j.phase]));

    for (const session of await repo.listSessions()) {
      const settledAt = session.endedAt ?? session.startedAt;
      if (settledAt < cutoff) continue;
      if (out.some((a) => a.sessionId === session.id)) continue;

      // Same derivation the meetings page uses, so the two never disagree.
      const status = deriveStatus({
        status: session.status,
        jobPhase: phases.get(session.id),
        hasMinutes: minutesIds.has(session.id),
      });
      const title = session.title ?? session.meetingCode;

      if (status === 'ready') {
        const minutes = await repo.getMinutes(session.id);
        out.push({
          kind: 'ready',
          sessionId: session.id,
          title,
          decisions: minutes?.decisions.length ?? 0,
          actionItems: minutes?.actionItems.length ?? 0,
        });
      } else if (status === 'failed') {
        out.push({
          kind: 'failed',
          sessionId: session.id,
          title,
          error: session.error ?? 'something went wrong',
        });
      }
    }

    return out;
  }

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

    if (captured > 0) await mom.queue(sessionId);
  }

  chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
    if (msg.type === 'ACTIVITY_QUERY') {
      void (async () => sendResponse(await buildActivity()))();
      return true;
    }

    if (msg.type === 'RETRY_REQUESTED') {
      void (async () => sendResponse(await mom.retry(msg.sessionId)))();
      return true;
    }

    if (msg.type === 'LLM_PROBE') {
      void (async () => {
        const cfg = await settings.get();
        const client = new OpenAiCompatibleClient({
          baseUrl: cfg.llmBaseUrl,
          apiKey: cfg.llmApiKey,
          model: cfg.llmModel,
        });
        // health() first: a GET succeeds even when the POST that writes the
        // minutes would be refused, so the connection test has to ask the
        // question the summariser will actually face.
        const health = await client.health();
        if (!health.ok) {
          sendResponse({
            ok: false,
            models: [],
            detail: health.detail,
            ...(health.originBlocked === true ? { originBlocked: true } : {}),
          } satisfies LlmProbeResult);
          return;
        }
        try {
          const models = await client.listModels();
          sendResponse({ ok: true, models: models.map((m) => m.id) } satisfies LlmProbeResult);
        } catch (e) {
          sendResponse({
            ok: false,
            models: [],
            detail: e instanceof Error ? e.message : String(e),
          } satisfies LlmProbeResult);
        }
      })();
      return true;
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
        case 'MOM_PROGRESS':
          break; // broadcast outward only
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
    if (alarm.name === MOM_ALARM) {
      void mom.step();
      return;
    }
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

  // The worker may be revived after a restart with work still in flight.
  void (async () => {
    await mom.resume();
    const watches = await loadWatches();
    if (watches.size > 0) {
      await chrome.alarms.create(WATCHDOG_ALARM, {
        periodInMinutes: WATCHDOG_TICK_MS / 60_000,
      });
    }
  })();
});
