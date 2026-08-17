import type { MomJobState } from '@/processing/mom/MomBuilder';
import { isJobRunning } from '@/processing/status';

export const JOB_KEY = 'saar:momJobs';

/**
 * Resume state for in-flight summarisation jobs.
 *
 * `chrome.storage.local`, not `storage.session` and not `localStorage`:
 *
 * - `localStorage` does not exist in an MV3 service worker at all — it is a
 *   synchronous window API.
 * - `storage.session` is wiped when the browser closes, which would strand a
 *   half-finished job forever.
 *
 * `storage.local` survives both service-worker termination and a full Chrome
 * restart, which is exactly the durability a multi-minute job needs.
 */
/**
 * Fills in fields added after a job was written.
 *
 * Jobs outlive the code that created them: one survives a browser restart by
 * design, so a job persisted by an older build is a normal thing to read, not
 * an edge case. Adding `callMs` without this made every pre-existing job throw
 * on `[...state.callMs]` — which took down both the summariser and the popup's
 * activity list, since both call `progressOf`.
 */
function normalise(row: Partial<MomJobState>): MomJobState {
  return {
    sessionId: row.sessionId ?? '',
    speakers: row.speakers ?? [],
    chunkTexts: row.chunkTexts ?? [],
    notes: row.notes ?? [],
    phase: row.phase ?? 'failed',
    minutes: row.minutes ?? null,
    attempts: row.attempts ?? 0,
    callMs: row.callMs ?? [],
    paused: row.paused ?? false,
    ...(row.error === undefined ? {} : { error: row.error }),
  };
}

export class JobStore {
  async all(): Promise<MomJobState[]> {
    const raw = await chrome.storage.local.get(JOB_KEY);
    const rows = (raw[JOB_KEY] as Partial<MomJobState>[] | undefined) ?? [];
    return rows.map(normalise);
  }

  async get(sessionId: string): Promise<MomJobState | null> {
    return (await this.all()).find((j) => j.sessionId === sessionId) ?? null;
  }

  async put(job: MomJobState): Promise<void> {
    const jobs = await this.all();
    const i = jobs.findIndex((j) => j.sessionId === job.sessionId);
    if (i === -1) jobs.push(job);
    else jobs[i] = job;
    await chrome.storage.local.set({ [JOB_KEY]: jobs });
  }

  async remove(sessionId: string): Promise<void> {
    const jobs = (await this.all()).filter((j) => j.sessionId !== sessionId);
    await chrome.storage.local.set({ [JOB_KEY]: jobs });
  }

  /** The next job with work left that the user has not paused, or null. */
  async nextPending(): Promise<MomJobState | null> {
    const jobs = await this.all();
    return jobs.find((j) => isJobRunning(j.phase) && !j.paused) ?? null;
  }
}
