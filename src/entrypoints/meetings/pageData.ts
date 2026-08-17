import type { TranscriptRepository } from '@/storage/TranscriptRepository';
import type { MeetingSession } from '@/session/types';
import type { JobStore } from '@/processing/job/JobStore';
import { deriveStatus, type UiStatus } from '@/processing/status';
import type { MomPhase, MomProgress } from '@/processing/mom/types';
import type { Activity, Message } from '@/messaging/messages';

/**
 * Everything the meetings page needs to draw itself, gathered in one pass.
 *
 * Four sources have to agree: the session rows, which meetings have minutes,
 * which have a job running, and how far along it is. Loading them together is
 * what stops the list and the detail pane disagreeing about the same meeting.
 */
export interface PageData {
  readonly sessions: readonly MeetingSession[];
  readonly minutesIds: ReadonlySet<string>;
  readonly phaseById: ReadonlyMap<string, MomPhase>;
  /** Sessions whose summarisation job the user has paused. */
  readonly pausedIds: ReadonlySet<string>;
  readonly progressById: ReadonlyMap<string, MomProgress>;
}

export const EMPTY_PAGE_DATA: PageData = {
  sessions: [],
  minutesIds: new Set(),
  phaseById: new Map(),
  pausedIds: new Set(),
  progressById: new Map(),
};

export async function loadPageData(
  repo: TranscriptRepository,
  jobs: JobStore,
): Promise<PageData> {
  const [sessions, ids, allJobs] = await Promise.all([
    repo.listSessions(),
    repo.listMinutesIds(),
    // Read the job store directly: it is chrome.storage.local, so an extension
    // page can see it without a message round trip to a worker that may be
    // asleep. The job is what decides "processing", not the session row.
    jobs.all(),
  ]);

  const activities = ((await chrome.runtime.sendMessage({
    type: 'ACTIVITY_QUERY',
  } satisfies Message)) ?? []) as Activity[];

  return {
    sessions,
    minutesIds: new Set(ids),
    phaseById: new Map(allJobs.map((j) => [j.sessionId, j.phase])),
    pausedIds: new Set(allJobs.filter((j) => j.paused).map((j) => j.sessionId)),
    progressById: new Map(
      activities
        .filter((a): a is Extract<Activity, { kind: 'processing' }> => a.kind === 'processing')
        .map((a) => [a.sessionId, a.progress]),
    ),
  };
}

/** Every surface derives status the same way — see processing/status.ts. */
export function statusOf(data: PageData, session: MeetingSession): UiStatus {
  return deriveStatus({
    status: session.status,
    jobPhase: data.phaseById.get(session.id),
    jobPaused: data.pausedIds.has(session.id),
    hasMinutes: data.minutesIds.has(session.id),
  });
}
