import type { SettingsStore } from '@/settings/types';
import type { TranscriptRepository } from '@/storage/TranscriptRepository';
import { JobStore } from '@/processing/job/JobStore';
import { MomBuilder, planJob, progressOf, type MomJobState } from '@/processing/mom/MomBuilder';
import { createLlmClient } from '@/processing/llm/createClient';
import type { MomProgress } from '@/processing/mom/types';

/**
 * Driving the summarisation queue from the background worker.
 *
 * One step per turn, persisted between steps. An MV3 service worker is
 * terminated after ~30s idle and summarising an hour-long meeting takes
 * minutes, so anything that ran to completion in a single call would be killed
 * partway and lose everything. Instead the job is advanced one model call at a
 * time and an alarm resumes it — a dead worker costs one chunk, not the meeting.
 */

export const MOM_ALARM = 'saar:mom';
/** Chrome's floor for a periodic alarm is 30 seconds. */
export const MOM_TICK_MINUTES = 0.5;

export interface RunnerDeps {
  readonly repo: TranscriptRepository;
  readonly settings: SettingsStore;
  readonly jobs: JobStore;
  readonly notify: (title: string, message: string) => Promise<void>;
  readonly onProgress: (sessionId: string, progress: MomProgress) => void;
  readonly now?: () => number;
}

export class MomRunner {
  /** One model call at a time, so a fast worker cannot overlap itself. */
  private busy = false;

  /**
   * The model call currently in flight, if any.
   *
   * Held so Pause and Cancel take effect now rather than whenever the model
   * finishes — a chunk against a slow local model can run for the better part
   * of a minute, and a button that does nothing for that long reads as broken.
   */
  private inFlight: { sessionId: string; controller: AbortController } | null = null;

  constructor(private readonly deps: RunnerDeps) {}

  /** Aborts the in-flight call for one session, if it is the one running. */
  private abortInFlight(sessionId: string): void {
    if (this.inFlight?.sessionId === sessionId) this.inFlight.controller.abort();
  }

  /**
   * Queues a finished meeting for summarising.
   *
   * Chunking happens here, up front and without touching the model, so the
   * total is known before the first call and resuming never re-chunks.
   */
  async queue(sessionId: string): Promise<void> {
    const cfg = await this.deps.settings.get();
    if (!cfg.momEnabled) return;

    const segments = await this.deps.repo.getSegments(sessionId);
    const job = planJob(sessionId, segments, { contextTokens: cfg.llmContextTokens });
    await this.deps.jobs.put(job);

    if (job.phase === 'failed') {
      await this.deps.repo.updateSession(sessionId, { status: 'failed', error: job.error });
      await this.deps.jobs.remove(sessionId);
      return;
    }

    await this.deps.repo.updateSession(sessionId, { status: 'summarizing' });
    await this.scheduleTick();
    void this.step();
  }

  /** Advances the queue by one model call, then keeps going while it can. */
  async step(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const job = await this.deps.jobs.nextPending();
      if (!job) {
        await chrome.alarms.clear(MOM_ALARM);
        return;
      }
      await this.advance(job);
    } finally {
      this.busy = false;
    }

    // Keep working while this worker happens to be alive; the alarm is only
    // the fallback for when it is not.
    if (await this.deps.jobs.nextPending()) void this.step();
  }

  private async advance(job: MomJobState): Promise<void> {
    const cfg = await this.deps.settings.get();
    const builder = new MomBuilder(
      createLlmClient({
        providerId: cfg.llmProviderId,
        baseUrl: cfg.llmBaseUrl,
        apiKey: cfg.llmApiKey,
        model: cfg.llmModel,
      }),
      { contextTokens: cfg.llmContextTokens },
      this.deps.now,
    );

    const controller = new AbortController();
    this.inFlight = { sessionId: job.sessionId, controller };
    let state: MomJobState;
    try {
      ({ state } = await builder.step(job, controller.signal));
    } finally {
      this.inFlight = null;
    }

    // Aborted on purpose. `step()` turns any throw into a 'failed' state, so
    // writing this one would report the user's own Pause as a model failure —
    // and would overwrite the paused (or deleted) job the control action just
    // persisted. Drop it instead; the chunk is simply redone on resume.
    if (controller.signal.aborted) return;

    await this.deps.jobs.put(state);
    this.deps.onProgress(state.sessionId, progressOf(state));

    if (state.phase === 'done' && state.minutes) {
      await this.deps.repo.saveMinutes(state.sessionId, state.minutes);
      await this.deps.repo.updateSession(state.sessionId, { status: 'complete' });
      await this.deps.jobs.remove(state.sessionId);
      const session = await this.deps.repo.getSession(state.sessionId);
      await this.deps.notify('Minutes ready', session?.title ?? session?.meetingCode ?? 'Meeting');
      return;
    }

    if (state.phase === 'failed') {
      // The transcript is already saved and the job is re-runnable from it, so
      // a model failure must never read as a lost meeting.
      await this.deps.repo.updateSession(state.sessionId, {
        status: 'failed',
        error: state.error,
      });
      await this.deps.jobs.remove(state.sessionId);
      await this.deps.notify(
        'Could not write minutes',
        state.error ?? 'the model was unreachable',
      );
    }
  }

  /**
   * Re-runs a meeting from its stored transcript.
   *
   * Refuses rather than half-acting when summaries are switched off: clearing
   * the old error and then returning silently made the button look broken, and
   * threw away the explanation of why the first attempt failed.
   */
  async retry(sessionId: string): Promise<boolean> {
    const cfg = await this.deps.settings.get();
    if (!cfg.momEnabled) return false;

    await this.deps.jobs.remove(sessionId);
    await this.deps.repo.updateSession(sessionId, { status: 'ended', error: undefined });
    await this.queue(sessionId);
    return true;
  }

  /**
   * Stops a run where it stands, keeping every chunk already summarised.
   *
   * Returns false when there is no job to pause — the popup and the meetings
   * page can both fire this at a job that finished a moment ago.
   */
  async pause(sessionId: string): Promise<boolean> {
    const job = await this.deps.jobs.get(sessionId);
    if (job === null || job.paused) return false;

    await this.deps.jobs.put({ ...job, paused: true });
    this.abortInFlight(sessionId);
    this.deps.onProgress(sessionId, progressOf(job));

    // Nothing else may be waiting, and an alarm with no work to do wakes the
    // worker every 30s for nothing.
    if (!(await this.deps.jobs.nextPending())) await chrome.alarms.clear(MOM_ALARM);
    return true;
  }

  /** Picks a paused job back up at the chunk it stopped on. */
  async unpause(sessionId: string): Promise<boolean> {
    const job = await this.deps.jobs.get(sessionId);
    if (job === null || !job.paused) return false;

    await this.deps.jobs.put({ ...job, paused: false });
    await this.scheduleTick();
    void this.step();
    return true;
  }

  /**
   * Abandons the run and the partial work with it.
   *
   * The transcript is untouched — the meeting simply goes back to being an
   * unsummarised one, with Summarise offered again.
   */
  async cancel(sessionId: string): Promise<boolean> {
    const job = await this.deps.jobs.get(sessionId);
    if (job === null) return false;

    await this.deps.jobs.remove(sessionId);
    this.abortInFlight(sessionId);
    await this.deps.repo.updateSession(sessionId, { status: 'ended', error: undefined });
    this.deps.onProgress(sessionId, progressOf(job));

    if (!(await this.deps.jobs.nextPending())) await chrome.alarms.clear(MOM_ALARM);
    return true;
  }

  /** Called on worker start: picks up anything left in flight. */
  async recover(): Promise<void> {
    if (!(await this.deps.jobs.nextPending())) return;
    await this.scheduleTick();
    void this.step();
  }

  private async scheduleTick(): Promise<void> {
    await chrome.alarms.create(MOM_ALARM, { periodInMinutes: MOM_TICK_MINUTES });
  }
}
