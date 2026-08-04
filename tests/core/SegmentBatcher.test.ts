import { describe, it, expect, vi } from 'vitest';
import { SegmentBatcher } from '@/core/capture/SegmentBatcher';
import type { Scheduler } from '@/core/ports/Scheduler';
import type { TranscriptSegment } from '@/core/types/transcript';

function seg(id: string, text: string, final = false): TranscriptSegment {
  return { id, final, speaker: 'Priya Nair', text, tStart: 0, tEnd: 1, source: 'meet-captions' };
}

function fakeScheduler() {
  const pending = new Map<number, () => void>();
  let next = 1;
  const s: Scheduler = {
    setTimeout: (fn) => {
      const h = next++;
      pending.set(h, fn);
      return h;
    },
    clearTimeout: (h) => {
      pending.delete(h);
    },
  };
  return {
    scheduler: s,
    fireAll: () => {
      const fns = [...pending.values()];
      pending.clear();
      fns.forEach((f) => f());
    },
    size: () => pending.size,
  };
}

describe('SegmentBatcher', () => {
  it('collapses repeated upserts of the same id into one flushed segment', () => {
    const flush = vi.fn();
    const { scheduler, fireAll } = fakeScheduler();
    const b = new SegmentBatcher(flush, { maxSegments: 20, maxDelayMs: 2000 }, scheduler);

    b.upsert(seg('a', 'I think'));
    b.upsert(seg('a', 'I think we should'));
    b.upsert(seg('a', 'I think we should ship', true));
    fireAll();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0]![0]).toEqual([seg('a', 'I think we should ship', true)]);
  });

  it('flushes immediately once maxSegments distinct ids are buffered', () => {
    const flush = vi.fn();
    const { scheduler } = fakeScheduler();
    const b = new SegmentBatcher(flush, { maxSegments: 3, maxDelayMs: 2000 }, scheduler);

    b.upsert(seg('a', 'one'));
    b.upsert(seg('b', 'two'));
    expect(flush).not.toHaveBeenCalled();
    b.upsert(seg('c', 'three'));

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0]![0]).toHaveLength(3);
  });

  it('preserves first-seen order across flushes', () => {
    const flush = vi.fn();
    const { scheduler, fireAll } = fakeScheduler();
    const b = new SegmentBatcher(flush, { maxSegments: 20, maxDelayMs: 2000 }, scheduler);

    b.upsert(seg('b', 'second'));
    b.upsert(seg('a', 'first'));
    b.upsert(seg('b', 'second revised'));
    fireAll();

    expect(flush.mock.calls[0]![0].map((s: TranscriptSegment) => s.id)).toEqual(['b', 'a']);
  });

  it('does nothing on flush when the buffer is empty', () => {
    const flush = vi.fn();
    const { scheduler, fireAll } = fakeScheduler();
    new SegmentBatcher(flush, { maxSegments: 20, maxDelayMs: 2000 }, scheduler);
    fireAll();
    expect(flush).not.toHaveBeenCalled();
  });

  it('dispose flushes what is buffered and cancels the timer', () => {
    const flush = vi.fn();
    const { scheduler, size } = fakeScheduler();
    const b = new SegmentBatcher(flush, { maxSegments: 20, maxDelayMs: 2000 }, scheduler);

    b.upsert(seg('a', 'partial'));
    b.dispose();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(size()).toBe(0);
  });
});
