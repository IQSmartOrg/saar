import { ChromeTabBot } from '@/bot/ChromeTabBot';
import type { MeetingBot } from '@/bot/MeetingBot';
import type { SettingsStore } from '@/settings/types';
import type { TranscriptRepository } from '@/storage/TranscriptRepository';
import { newSessionId } from '@/session/types';
import type { ActiveSession } from '@/session/SessionRegistry';
import {
  isCleanStop,
  SessionStopWatch,
  WATCHDOG_TICK_MS,
  type ImmediateStopReason,
  type StopDecision,
} from '@/session/stopSignals';
import type { MomRunner } from '@/processing/job/MomRunner';
import type { BackgroundState } from '@/background/state';
import { notify } from '@/background/notify';

export const WATCHDOG_ALARM = 'saar:watchdog';

export interface CoordinatorDeps {
  readonly repo: TranscriptRepository;
  readonly settings: SettingsStore;
  readonly state: BackgroundState;
  readonly mom: MomRunner;
  /** Injectable so the cloud build can swap ChromeTabBot for a Puppeteer one. */
  readonly createBot?: () => MeetingBot;
}

/**
 * The life of one recorded meeting: spawn the notetaker, watch for the nine
 * stop signals, tear down, hand the transcript to the summariser.
 *
 * Every stop signal converges on `end()`, which is idempotent — several of them
 * routinely fire for the same meeting (the user leaves, then their tab closes,
 * then the bot reports it is no longer in the call).
 */
export class SessionCoordinator {
  /** Live bots, by session. Empty after a worker restart, which `end()` handles. */
  private readonly bots = new Map<string, MeetingBot>();

  constructor(private readonly deps: CoordinatorDeps) {}

  private newBot(): MeetingBot {
    return this.deps.createBot?.() ?? new ChromeTabBot();
  }

  async start(meetingCode: string, userTabId: number, title: string | null): Promise<void> {
    const { repo, settings, state } = this.deps;

    const registry = await state.loadRegistry();
    if (registry.byMeetingCode(meetingCode)) return; // idempotent

    const cfg = await settings.get();
    if (cfg.botAccountIndex === null) {
      await notify('Saar needs setup', 'Choose the notetaker Google account in the Saar popup.');
      return;
    }

    const sessionId = newSessionId();
    await repo.createSession({
      id: sessionId,
      platform: 'google-meet',
      meetingCode,
      title,
      startedAt: Date.now(),
      endedAt: null,
      participants: [],
      status: 'joining',
    });

    // Through the MeetingBot port, never chrome.tabs directly — this port is
    // what a headless driver replaces in the cloud build.
    const bot = this.newBot();
    this.bots.set(sessionId, bot);
    const result = await bot.join({ sessionId, meetingCode, accountIndex: cfg.botAccountIndex });
    if (!result.ok) {
      await repo.updateSession(sessionId, { status: 'failed', error: result.error });
      this.bots.delete(sessionId);
      return;
    }

    const entry: ActiveSession = {
      sessionId,
      meetingCode,
      userTabId,
      botTabId: result.tabId ?? null,
    };
    registry.add(entry);
    await state.saveRegistry(registry);

    const watches = await state.loadWatches();
    watches.set(sessionId, SessionStopWatch.start(sessionId, Date.now()));
    await state.saveWatches(watches);
    await this.armWatchdog();
  }

  async end(sessionId: string, decision?: StopDecision): Promise<void> {
    const { repo, state, mom } = this.deps;

    const registry = await state.loadRegistry();
    const entry = registry.bySessionId(sessionId);
    if (!entry) return; // idempotent — several signals converge here

    registry.remove(sessionId);
    await state.saveRegistry(registry);

    const watches = await state.loadWatches();
    watches.delete(sessionId);
    await state.saveWatches(watches);
    if (watches.size === 0) await chrome.alarms.clear(WATCHDOG_ALARM);

    // Prefer the bot's own leave(). After a service-worker restart the
    // in-memory bot is gone, so fall back to the tab id we persisted.
    const bot = this.bots.get(sessionId);
    if (bot) {
      await bot.leave();
    } else if (entry.botTabId !== null) {
      try {
        await chrome.tabs.remove(entry.botTabId);
      } catch {
        /* already gone */
      }
    }
    this.bots.delete(sessionId);

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

  /** Applies a mutation to one session's watch and acts on any decision. */
  async withWatch(
    sessionId: string,
    fn: (watch: SessionStopWatch) => StopDecision | null,
  ): Promise<void> {
    const watches = await this.deps.state.loadWatches();
    const watch = watches.get(sessionId);
    if (!watch) return;

    const decision = fn(watch);
    await this.deps.state.saveWatches(watches);
    if (decision) await this.end(sessionId, decision);
  }

  /** Resolves a meeting code to its session, for signals that only know the code. */
  async signalByCode(meetingCode: string, reason: ImmediateStopReason): Promise<void> {
    const registry = await this.deps.state.loadRegistry();
    const entry = registry.byMeetingCode(meetingCode);
    if (entry) await this.withWatch(entry.sessionId, (w) => w.signal(reason));
  }

  /** Signal 3: either tab closing ends the session. */
  async signalByTab(tabId: number): Promise<void> {
    const registry = await this.deps.state.loadRegistry();
    const entry = registry.byTabId(tabId);
    if (entry) await this.withWatch(entry.sessionId, (w) => w.signal('tab-closed'));
  }

  /** Signals 6 and 9: the periodic liveness sweep. */
  async runWatchdog(now: number = Date.now()): Promise<void> {
    const watches = await this.deps.state.loadWatches();
    if (watches.size === 0) {
      await chrome.alarms.clear(WATCHDOG_ALARM);
      return;
    }

    const due: Array<[string, StopDecision]> = [];
    for (const [id, watch] of watches) {
      const decision = watch.check(now);
      if (decision) due.push([id, decision]);
    }
    await this.deps.state.saveWatches(watches);
    for (const [id, decision] of due) await this.end(id, decision);
  }

  /** Re-arms the watchdog after a worker restart, if anything is still live. */
  async armWatchdogIfBusy(): Promise<void> {
    const watches = await this.deps.state.loadWatches();
    if (watches.size > 0) await this.armWatchdog();
  }

  private async armWatchdog(): Promise<void> {
    // chrome.alarms rather than setTimeout: a timer in an MV3 worker dies with
    // the worker, so the guarantee would silently evaporate exactly when it is
    // needed. Alarms survive termination and wake the worker to run this.
    await chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: WATCHDOG_TICK_MS / 60_000 });
  }
}
