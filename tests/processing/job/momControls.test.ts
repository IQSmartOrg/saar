import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JobStore } from '@/processing/job/JobStore';
import { MomRunner } from '@/processing/job/MomRunner';
import type { MomJobState } from '@/processing/mom/MomBuilder';
import type { Settings } from '@/settings/types';

/**
 * Pause, resume and cancel.
 *
 * The behaviour worth pinning down is what happens to work already done: a
 * pause must keep every summarised chunk, and a cancel must put the meeting
 * back to being a plain transcript without touching the transcript itself.
 */

let store: Record<string, unknown>;
let cleared: string[];

beforeEach(() => {
  store = {};
  cleared = [];
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (patch: Record<string, unknown>) => Object.assign(store, patch),
      },
    },
    alarms: {
      create: async () => undefined,
      clear: async (name: string) => {
        cleared.push(name);
        return true;
      },
    },
  });
});

function job(patch: Partial<MomJobState> = {}): MomJobState {
  return {
    sessionId: 's1',
    speakers: ['Ana'],
    chunkTexts: ['one', 'two', 'three'],
    notes: [
      {
        topics: [],
        decisions: [],
        actionItems: [],
        openQuestions: [],
        summary: 'first chunk',
      },
    ],
    phase: 'mapping',
    minutes: null,
    attempts: 0,
    callMs: [1000],
    paused: false,
    ...patch,
  };
}

interface Harness {
  readonly runner: MomRunner;
  readonly jobs: JobStore;
  readonly updates: Array<[string, Record<string, unknown>]>;
}

function harness(): Harness {
  const jobs = new JobStore();
  const updates: Array<[string, Record<string, unknown>]> = [];

  const runner = new MomRunner({
    jobs,
    repo: {
      updateSession: async (id: string, patch: Record<string, unknown>) => {
        updates.push([id, patch]);
      },
      getSegments: async () => [],
      getSession: async () => null,
      saveMinutes: async () => undefined,
    } as never,
    settings: { get: async (): Promise<Partial<Settings>> => ({ momEnabled: true }) } as never,
    notify: async () => undefined,
    onProgress: () => undefined,
  });

  return { runner, jobs, updates };
}

describe('pause', () => {
  it('keeps the job and every chunk already summarised', async () => {
    const { runner, jobs } = harness();
    await jobs.put(job());

    expect(await runner.pause('s1')).toBe(true);

    const saved = await jobs.get('s1');
    expect(saved?.paused).toBe(true);
    // The phase is untouched, which is what lets resume pick up the same chunk.
    expect(saved?.phase).toBe('mapping');
    expect(saved?.notes).toHaveLength(1);
  });

  it('takes the job out of the queue without deleting it', async () => {
    const { runner, jobs } = harness();
    await jobs.put(job());

    await runner.pause('s1');

    expect(await jobs.nextPending()).toBeNull();
    expect(await jobs.all()).toHaveLength(1);
  });

  it('stops the alarm, so a paused queue does not wake the worker every 30s', async () => {
    const { runner, jobs } = harness();
    await jobs.put(job());

    await runner.pause('s1');

    expect(cleared).toContain('saar:mom');
  });

  it('leaves the alarm alone while another meeting is still summarising', async () => {
    const { runner, jobs } = harness();
    await jobs.put(job());
    await jobs.put(job({ sessionId: 's2' }));

    await runner.pause('s1');

    expect(cleared).not.toContain('saar:mom');
    expect((await jobs.nextPending())?.sessionId).toBe('s2');
  });

  it('answers false when there is no job — the card may be a moment stale', async () => {
    const { runner } = harness();
    expect(await runner.pause('gone')).toBe(false);
  });

  it('is idempotent: pausing twice is not an error state', async () => {
    const { runner, jobs } = harness();
    await jobs.put(job({ paused: true }));
    expect(await runner.pause('s1')).toBe(false);
    expect((await jobs.get('s1'))?.paused).toBe(true);
  });
});

describe('resume', () => {
  it('puts the job back in the queue at the chunk it stopped on', async () => {
    const { runner, jobs } = harness();
    await jobs.put(job({ paused: true }));

    expect(await runner.unpause('s1')).toBe(true);

    const pending = await jobs.nextPending();
    expect(pending?.sessionId).toBe('s1');
    expect(pending?.notes).toHaveLength(1);
  });

  it('answers false for a job that was never paused', async () => {
    const { runner, jobs } = harness();
    await jobs.put(job());
    expect(await runner.unpause('s1')).toBe(false);
  });
});

describe('cancel', () => {
  it('drops the job and returns the meeting to an unsummarised transcript', async () => {
    const { runner, jobs, updates } = harness();
    await jobs.put(job());

    expect(await runner.cancel('s1')).toBe(true);

    expect(await jobs.all()).toEqual([]);
    // 'ended' rather than 'failed': the user stopped it, nothing went wrong.
    expect(updates).toContainEqual(['s1', { status: 'ended', error: undefined }]);
  });

  it('works on a paused job too', async () => {
    const { runner, jobs } = harness();
    await jobs.put(job({ paused: true }));

    expect(await runner.cancel('s1')).toBe(true);
    expect(await jobs.all()).toEqual([]);
  });

  it('answers false when there is nothing to cancel', async () => {
    const { runner } = harness();
    expect(await runner.cancel('gone')).toBe(false);
  });
});

describe('jobs persisted before pause existed', () => {
  it('reads as running rather than paused', async () => {
    const jobs = new JobStore();
    const { paused: _paused, ...legacy } = job();
    store['saar:momJobs'] = [legacy];

    expect((await jobs.get('s1'))?.paused).toBe(false);
    expect(await jobs.nextPending()).not.toBeNull();
  });
});
