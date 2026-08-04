import type { TranscriptSegment, TranscriptSourceKind } from '@/core/types/transcript';

export interface SegmentSink {
  upsert(segment: TranscriptSegment): void;
}

export interface SourceHealth {
  readonly ok: boolean;
  readonly selectorsMatched: boolean;
  readonly segmentsSeen: number;
  readonly lastSegmentAt: number | null;
  readonly detail?: string;
}

export interface TranscriptSource {
  readonly kind: TranscriptSourceKind;
  start(sink: SegmentSink): Promise<void>;
  stop(): Promise<void>;
  health(): SourceHealth;
}
