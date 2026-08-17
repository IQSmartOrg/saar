import type { TranscriptRepository } from '@/storage/TranscriptRepository';
import type { JobStore } from '@/processing/job/JobStore';
import { progressOf } from '@/processing/mom/MomBuilder';
import { deriveStatus, isJobRunning } from '@/processing/status';
import type { Activity } from '@/messaging/messages';
import type { BackgroundState } from '@/background/state';

/** How long a finished or failed meeting stays on the Now list. */
export const RECENT_MS = 10 * 60_000;

export interface ActivityDeps {
  readonly repo: TranscriptRepository;
  readonly jobs: JobStore;
  readonly state: BackgroundState;
}

/**
 * Everything Saar is doing right now, as one list.
 *
 * A single list rather than separate recording and processing queries, because
 * summarising begins when a meeting ENDS and therefore outlives it: someone can
 * be recording their 3pm while the 2pm is still being written up.
 *
 * Recording comes first because it is the only row that is time-critical — Stop
 * is pressed under pressure, so it must not move down the list as finished
 * meetings pile up behind it.
 */
export async function buildActivity(deps: ActivityDeps): Promise<Activity[]> {
  const { repo, jobs, state } = deps;
  const out: Activity[] = [];

  const registry = await state.loadRegistry();
  for (const entry of registry.all()) {
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

  const allJobs = await jobs.all();
  for (const job of allJobs) {
    if (!isJobRunning(job.phase)) continue;
    const session = await repo.getSession(job.sessionId);
    out.push({
      kind: 'processing',
      sessionId: job.sessionId,
      title: session?.title ?? session?.meetingCode ?? 'Meeting',
      progress: progressOf(job),
      paused: job.paused,
    });
  }

  // Recently settled meetings, so a completed run is never something the user
  // only learns about from a notification they missed.
  const cutoff = Date.now() - RECENT_MS;
  const minutesIds = new Set(await repo.listMinutesIds());
  const phases = new Map(allJobs.map((j) => [j.sessionId, j.phase]));
  const paused = new Set(allJobs.filter((j) => j.paused).map((j) => j.sessionId));

  for (const session of await repo.listSessions()) {
    const settledAt = session.endedAt ?? session.startedAt;
    if (settledAt < cutoff) continue;
    if (out.some((a) => a.sessionId === session.id)) continue;

    // Same derivation the meetings page uses, so the two never disagree.
    const status = deriveStatus({
      status: session.status,
      jobPhase: phases.get(session.id),
      jobPaused: paused.has(session.id),
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
