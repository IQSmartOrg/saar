import { describe, it, expect } from 'vitest';
import {
  canSummarise,
  deriveStatus,
  isJobRunning,
  STATUS_LABEL,
  STATUS_TONE,
  type UiStatus,
} from '@/processing/status';
import type { SessionStatus } from '@/core/types/session';
import type { MomPhase } from '@/processing/types';

const NO_MINUTES = { hasMinutes: false } as const;
const WITH_MINUTES = { hasMinutes: true } as const;

describe('live meetings', () => {
  it.each<SessionStatus>(['joining', 'in-lobby', 'capturing'])('%s is recording', (status) => {
    expect(deriveStatus({ status, ...NO_MINUTES })).toBe('recording');
  });

  it('stays recording even if a stale job is lying around', () => {
    expect(deriveStatus({ status: 'capturing', jobPhase: 'mapping', ...NO_MINUTES })).toBe(
      'recording',
    );
  });
});

describe('a running job outranks the stored status', () => {
  it.each<MomPhase>(['queued', 'chunking', 'mapping', 'reducing'])(
    'phase %s reads as processing',
    (jobPhase) => {
      // The gap between queueing a job and writing 'summarizing' to the session
      // row is real: without this rule a meeting actively being summarised
      // shows up as a plain transcript.
      expect(deriveStatus({ status: 'ended', jobPhase, ...NO_MINUTES })).toBe('processing');
    },
  );

  it('does not treat a finished job as still running', () => {
    expect(deriveStatus({ status: 'complete', jobPhase: 'done', ...WITH_MINUTES })).toBe('ready');
    expect(deriveStatus({ status: 'failed', jobPhase: 'failed', ...NO_MINUTES })).toBe('failed');
  });
});

describe('recovering from a stranded session row', () => {
  it('does not leave a spinner running when no job exists', () => {
    // The worker died between finishing the job and updating the row. Reading
    // the row alone would show "Writing…" forever with a bar that never moves.
    expect(deriveStatus({ status: 'summarizing', ...NO_MINUTES })).toBe('transcript');
  });

  it('prefers the minutes that actually exist', () => {
    expect(deriveStatus({ status: 'summarizing', ...WITH_MINUTES })).toBe('ready');
  });

  it('offers a re-run when marked complete but the minutes are missing', () => {
    // An empty "Ready" page is worse than admitting nothing was written.
    expect(deriveStatus({ status: 'complete', ...NO_MINUTES })).toBe('transcript');
  });
});

describe('settled meetings', () => {
  it('reports a failed summary as failed', () => {
    expect(deriveStatus({ status: 'failed', ...NO_MINUTES })).toBe('failed');
  });

  it('distinguishes never-summarised from failed', () => {
    // Both have a complete transcript; only one is a fault.
    expect(deriveStatus({ status: 'ended', ...NO_MINUTES })).toBe('transcript');
    expect(deriveStatus({ status: 'failed', ...NO_MINUTES })).toBe('failed');
  });

  it('reports a completed meeting as ready', () => {
    expect(deriveStatus({ status: 'complete', ...WITH_MINUTES })).toBe('ready');
  });
});

describe('isJobRunning', () => {
  it('covers every phase that consumes model calls', () => {
    expect(['queued', 'chunking', 'mapping', 'reducing'].every((p) => isJobRunning(p as MomPhase))).toBe(
      true,
    );
  });

  it('excludes terminal phases and a missing job', () => {
    expect(isJobRunning('done')).toBe(false);
    expect(isJobRunning('failed')).toBe(false);
    expect(isJobRunning(undefined)).toBe(false);
  });
});

describe('canSummarise', () => {
  it('is false without a transcript — there is nothing to read', () => {
    expect(canSummarise('transcript', false)).toBe(false);
  });

  it('is false while the meeting is live or already running', () => {
    expect(canSummarise('recording', true)).toBe(false);
    expect(canSummarise('processing', true)).toBe(false);
  });

  it('allows a re-run on ready, failed and never-summarised meetings', () => {
    expect(canSummarise('ready', true)).toBe(true);
    expect(canSummarise('failed', true)).toBe(true);
    expect(canSummarise('transcript', true)).toBe(true);
  });
});

describe('presentation tables stay complete', () => {
  const all: UiStatus[] = ['recording', 'processing', 'ready', 'failed', 'transcript'];

  it('has a label and a tone for every status', () => {
    for (const s of all) {
      expect(STATUS_LABEL[s]).toBeTruthy();
      expect(STATUS_TONE[s]).toBeTruthy();
    }
  });
});
