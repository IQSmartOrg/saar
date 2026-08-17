import type { ActionItem, Decision, Topic } from '@/core/types/minutes';

/** Notes produced from a single chunk during the map phase. */
export interface ChunkNotes {
  readonly topics: readonly Topic[];
  readonly decisions: readonly Decision[];
  readonly actionItems: readonly ActionItem[];
  readonly openQuestions: readonly string[];
  readonly summary: string;
}

export type MomPhase = 'queued' | 'chunking' | 'mapping' | 'reducing' | 'done' | 'failed';

export interface MomProgress {
  readonly phase: MomPhase;
  /** Model calls completed. */
  readonly done: number;
  /**
   * Total model calls: one per chunk, plus the merge.
   *
   * The same denominator for every phase, deliberately. An earlier version
   * counted chunks while mapping and chunks+1 while reducing, so the bar
   * climbed to 100% and then jumped backwards to ~87% for the final step.
   */
  readonly total: number;
  readonly detail?: string;
  /** Estimated milliseconds remaining, from the calls already timed. */
  readonly etaMs?: number;
}

export function progressPercent(p: MomProgress): number {
  if (p.phase === 'done') return 100;
  if (p.total <= 0) return 0;
  return Math.min(99, Math.round((p.done / p.total) * 100));
}

export function describePhase(p: MomProgress): string {
  switch (p.phase) {
    case 'queued':
      return 'Waiting to start…';
    case 'chunking':
      return 'Preparing the transcript…';
    case 'mapping':
      // `total` counts the merge too, so subtract it to name the transcript part.
      return `Reading the transcript — part ${Math.min(p.done + 1, p.total - 1)} of ${p.total - 1}`;
    case 'reducing':
      return 'Writing the minutes…';
    case 'done':
      return 'Minutes ready';
    case 'failed':
      return p.detail ?? 'Could not create minutes';
  }
}

/** "about 2 min left" — deliberately vague, because the estimate is one. */
export function describeEta(etaMs: number | undefined): string | null {
  if (etaMs === undefined || etaMs <= 0) return null;
  const secs = Math.round(etaMs / 1000);
  if (secs < 45) return 'less than a minute left';
  return `about ${Math.round(secs / 60)} min left`;
}
