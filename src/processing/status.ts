import type { SessionStatus } from '@/core/types/session';
import type { MomPhase } from '@/processing/types';

/**
 * The one place a meeting's displayed status is decided.
 *
 * Four vocabularies describe the same meeting: `SessionStatus` in the
 * repository, `MomPhase` in the summarisation job, the chip in the meetings
 * list, and the card in the popup. Deriving each surface separately is how they
 * drift, so every surface goes through `deriveStatus` instead.
 *
 * The rule that matters: **the job outranks the stored status.** A session row
 * is written before and after each step, so it is the field most likely to be
 * stale after a service-worker death, while the job is the thing actually doing
 * the work. Reading the row alone is what strands a meeting on a spinner that
 * never moves.
 */

export type UiStatus =
  /** Still in the call. */
  | 'recording'
  /** Transcript captured, minutes being written right now. */
  | 'processing'
  /** Minutes written. */
  | 'ready'
  /** Summarising was attempted and failed. The transcript survives. */
  | 'failed'
  /** Captured but not summarised — AI was off, or never asked for. */
  | 'transcript';

export interface StatusInputs {
  readonly status: SessionStatus;
  /** Phase of the live summarisation job, or undefined when there is none. */
  readonly jobPhase?: MomPhase;
  readonly hasMinutes: boolean;
}

/** Phases where the job is actively consuming model calls. */
export function isJobRunning(phase: MomPhase | undefined): boolean {
  return phase === 'queued' || phase === 'chunking' || phase === 'mapping' || phase === 'reducing';
}

export function deriveStatus(input: StatusInputs): UiStatus {
  const { status, jobPhase, hasMinutes } = input;

  // 1. Live meetings win outright. Nothing about summarising can be true yet.
  if (status === 'joining' || status === 'in-lobby' || status === 'capturing') {
    return 'recording';
  }

  // 2. A running job beats whatever the session row says. This covers the gap
  //    between queueing a job and marking the session 'summarizing' — without
  //    it, a meeting actively being summarised shows as a plain transcript.
  if (isJobRunning(jobPhase)) return 'processing';

  // 3. The stored status says summarising but no job is running: the worker
  //    died between finishing the job and updating the row. Trust the data that
  //    exists rather than leaving a progress bar that will never move again.
  if (status === 'summarizing') {
    return hasMinutes ? 'ready' : 'transcript';
  }

  if (status === 'failed') return 'failed';

  // 4. Marked complete but the minutes are missing — treat it as unsummarised
  //    so the user is offered a re-run instead of an empty page.
  if (status === 'complete') return hasMinutes ? 'ready' : 'transcript';

  return 'transcript';
}

/** Short label for the status chip. */
export const STATUS_LABEL: Record<UiStatus, string> = {
  recording: 'Rec',
  processing: 'Writing',
  ready: 'Ready',
  failed: 'Failed',
  transcript: 'Transcript',
};

/** Chip styling class, kept beside the label so the two cannot drift apart. */
export const STATUS_TONE: Record<UiStatus, string> = {
  recording: 'live',
  processing: 'work',
  ready: 'ready',
  failed: 'bad',
  transcript: 'plain',
};

/** Whether re-running summarisation makes sense for this meeting. */
export function canSummarise(status: UiStatus, hasTranscript: boolean): boolean {
  if (!hasTranscript) return false;
  return status === 'ready' || status === 'failed' || status === 'transcript';
}
