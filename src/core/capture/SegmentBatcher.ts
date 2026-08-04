import type { SegmentSink } from '@/core/ports/TranscriptSource';
import type { Scheduler } from '@/core/ports/Scheduler';
import type { TranscriptSegment } from '@/core/types/transcript';

export interface BatcherOptions {
  readonly maxSegments: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_BATCHER_OPTIONS: BatcherOptions = {
  maxSegments: 20,
  maxDelayMs: 2000,
};

/**
 * Meet rewrites a caption block many times per second as its ASR refines the
 * utterance. Writing one row per mutation would mean dozens of IndexedDB
 * transactions per sentence, so we collapse repeated upserts of the same id and
 * flush on whichever comes first: `maxSegments` distinct ids or `maxDelayMs`.
 */
export class SegmentBatcher implements SegmentSink {
  // Map preserves first-insertion order, which is the order we flush in.
  private buffer = new Map<string, TranscriptSegment>();
  private timer: number | null = null;

  constructor(
    private readonly flush: (segments: TranscriptSegment[]) => void,
    private readonly opts: BatcherOptions,
    private readonly scheduler: Scheduler,
  ) {}

  upsert(segment: TranscriptSegment): void {
    this.buffer.set(segment.id, segment);

    if (this.buffer.size >= this.opts.maxSegments) {
      this.flushNow();
      return;
    }
    if (this.timer === null) {
      this.timer = this.scheduler.setTimeout(() => {
        this.timer = null;
        this.flushNow();
      }, this.opts.maxDelayMs);
    }
  }

  flushNow(): void {
    if (this.timer !== null) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.size === 0) return;
    const batch = [...this.buffer.values()];
    this.buffer.clear();
    this.flush(batch);
  }

  dispose(): void {
    this.flushNow();
  }
}
