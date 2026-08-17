import { describe, it, expect } from 'vitest';
import { deriveStatus } from '@/processing/status';
import type { SessionStatus } from '@/session/types';
import type { MomPhase } from '@/processing/mom/types';

/**
 * The rule behind the meetings page's live tick.
 *
 * Polling used to run whenever ANY meeting was busy, and re-rendered the whole
 * detail pane — so reading a month-old transcript blinked every two seconds
 * because something unrelated was recording elsewhere.
 */
function liveTarget(
  status: SessionStatus,
  tab: 'minutes' | 'transcript',
  hasMinutes = false,
  jobPhase?: MomPhase,
): 'transcript' | 'progress' | null {
  // jobPhase matters: a session row reading 'summarizing' with no job behind it
  // is a stranded row, not work in progress, and must not be polled.
  const state = deriveStatus({ status, jobPhase, hasMinutes });
  if (state === 'recording' && tab === 'transcript') return 'transcript';
  if (state === 'processing' && tab === 'minutes') return 'progress';
  return null;
}

describe('when the page polls', () => {
  it('follows a live meeting on the transcript tab', () => {
    expect(liveTarget('capturing', 'transcript')).toBe('transcript');
  });

  it('does not poll a live meeting while its minutes are on screen', () => {
    // Nothing about the minutes moves until the meeting ends.
    expect(liveTarget('capturing', 'minutes')).toBeNull();
  });

  it('follows a progress bar on the minutes tab', () => {
    expect(liveTarget('summarizing', 'minutes', false, 'mapping')).toBe('progress');
  });

  it('does not poll a summarising meeting while reading its transcript', () => {
    // The transcript is complete by then; only the bar is moving.
    expect(liveTarget('summarizing', 'transcript', false, 'mapping')).toBeNull();
  });

  it('does not poll a stranded row with no job behind it', () => {
    // Worker died after finishing; there is no bar left to move.
    expect(liveTarget('summarizing', 'minutes')).toBeNull();
  });

  it.each<[SessionStatus, 'minutes' | 'transcript']>([
    ['complete', 'minutes'],
    ['complete', 'transcript'],
    ['ended', 'minutes'],
    ['ended', 'transcript'],
    ['failed', 'minutes'],
  ])('never polls a settled meeting (%s, %s tab)', (status, tab) => {
    expect(liveTarget(status, tab, status === 'complete')).toBeNull();
  });
});
