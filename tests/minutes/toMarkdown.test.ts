import { describe, it, expect } from 'vitest';
import { formatTimestamp } from '@/utils/time';
import {
  meetingToMarkdown,
  minutesToMarkdown,
  transcriptToMarkdown,
} from '@/minutes/toMarkdown';
import { EMPTY_MINUTES, type MeetingMinutes } from '@/minutes/types';
import type { MeetingSession } from '@/session/types';
import type { TranscriptSegment } from '@/capture/types';

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

describe('minutesToMarkdown', () => {
  const full: MeetingMinutes = {
    summary: 'We shipped.',
    topics: [{ title: 'Release', points: ['QA green'], speakers: ['Ana'] }],
    decisions: [{ decision: 'Ship Friday', context: 'QA is green' }],
    actionItems: [
      { owner: 'Ana Roy', task: 'Cut the build', due: 'Thursday', quote: 'I will cut it.' },
    ],
    openQuestions: ['Tell support when?'],
  };

  it('writes every section', () => {
    const md = minutesToMarkdown(full);
    expect(md).toContain('## Summary');
    expect(md).toContain('### Release');
    expect(md).toContain('- **Ship Friday** — QA is green');
    expect(md).toContain('- **Ana Roy** — Cut the build _(by Thursday)_');
    expect(md).toContain('## Open questions');
  });

  it('keeps the quote, since that is what makes a claim checkable', () => {
    expect(minutesToMarkdown(full)).toContain('> I will cut it.');
  });

  it('skips empty sections rather than writing bare headings', () => {
    const md = minutesToMarkdown({ ...EMPTY_MINUTES, summary: 'Only this.' });
    expect(md).toContain('## Summary');
    expect(md).not.toContain('## Decisions');
  });

  it('falls back to raw text when the model output could not be parsed', () => {
    const md = minutesToMarkdown({ ...EMPTY_MINUTES, raw: 'Unstructured reply.' });
    expect(md).toContain('Unstructured reply.');
  });
});

describe('meetingToMarkdown', () => {
  const session: MeetingSession = {
    id: 's1',
    platform: 'google-meet',
    meetingCode: 'abc-defg-hij',
    title: 'Weekly sync',
    startedAt: 0,
    endedAt: 600_000,
    participants: [],
    status: 'complete',
  };
  const segments: TranscriptSegment[] = [
    { id: 'a', final: true, speaker: 'Ana', text: 'Hello there.', tStart: 0, tEnd: 2, source: 'meet-captions' },
  ];

  it('puts the minutes above the transcript they came from', () => {
    const md = meetingToMarkdown(session, segments, { ...EMPTY_MINUTES, summary: 'We met.' });
    expect(md.indexOf('## Summary')).toBeLessThan(md.indexOf('## Transcript'));
  });

  it('always includes the transcript — minutes alone lose the evidence', () => {
    const md = meetingToMarkdown(session, segments, { ...EMPTY_MINUTES, summary: 'We met.' });
    expect(md).toContain('Hello there.');
  });

  it('is just the transcript when there are no minutes', () => {
    const md = meetingToMarkdown(session, segments, null);
    expect(md).toContain('## Transcript');
    expect(md).not.toContain('## Summary');
  });
});
