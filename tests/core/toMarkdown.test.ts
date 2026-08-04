import { describe, it, expect } from 'vitest';
import { transcriptToMarkdown, formatTimestamp } from '@/core/export/toMarkdown';
import type { MeetingSession } from '@/core/types/session';
import type { TranscriptSegment } from '@/core/types/transcript';

const session: MeetingSession = {
  id: 's1',
  platform: 'google-meet',
  meetingCode: 'abc-defg-hij',
  title: 'Weekly Sync',
  startedAt: Date.UTC(2026, 7, 5, 9, 30),
  endedAt: Date.UTC(2026, 7, 5, 10, 0),
  participants: ['Priya Nair', 'Rahul Shah'],
  status: 'ended',
};

function seg(p: Partial<TranscriptSegment>): TranscriptSegment {
  return {
    id: 'x',
    final: true,
    speaker: 'Priya Nair',
    text: 'hello',
    tStart: 0,
    tEnd: 2,
    source: 'meet-captions',
    ...p,
  };
}

describe('formatTimestamp', () => {
  it('formats seconds as mm:ss', () => {
    expect(formatTimestamp(0)).toBe('00:00');
    expect(formatTimestamp(75)).toBe('01:15');
  });
  it('formats past an hour as hh:mm:ss', () => {
    expect(formatTimestamp(3725)).toBe('01:02:05');
  });
});

describe('transcriptToMarkdown', () => {
  it('renders a title, metadata, and speaker-prefixed lines', () => {
    const md = transcriptToMarkdown(session, [
      seg({ id: 'a', speaker: 'Priya Nair', text: 'Shall we start?', tStart: 5 }),
      seg({ id: 'b', speaker: 'Rahul Shah', text: 'Yes.', tStart: 9 }),
    ]);
    expect(md).toContain('# Weekly Sync');
    expect(md).toContain('abc-defg-hij');
    expect(md).toContain('Priya Nair, Rahul Shah');
    expect(md).toContain('**Priya Nair** [00:05] Shall we start?');
    expect(md).toContain('**Rahul Shah** [00:09] Yes.');
  });

  it('falls back to the meeting code when there is no title', () => {
    expect(transcriptToMarkdown({ ...session, title: null }, [])).toContain('# abc-defg-hij');
  });

  it('labels unattributed segments', () => {
    const md = transcriptToMarkdown(session, [seg({ speaker: null, text: 'inaudible', tStart: 3 })]);
    expect(md).toContain('**Unknown** [00:03] inaudible');
  });

  it('skips non-final segments so partial captions never reach the export', () => {
    const md = transcriptToMarkdown(session, [
      seg({ id: 'a', text: 'complete thought', final: true }),
      seg({ id: 'b', text: 'half a thou', final: false }),
    ]);
    expect(md).toContain('complete thought');
    expect(md).not.toContain('half a thou');
  });

  it('states plainly when there is no transcript', () => {
    expect(transcriptToMarkdown(session, [])).toContain('_No transcript captured._');
  });
});
