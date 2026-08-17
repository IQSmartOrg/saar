import { describe, it, expect } from 'vitest';
import {
  dayLabel,
  durationMinutes,
  groupByDay,
  matches,
  TRANSCRIPT_SEARCH_MIN,
} from '@/entrypoints/meetings/listModel';
import type { MeetingSession } from '@/session/types';

const DAY = 86_400_000;
const NOW = new Date('2026-08-17T14:00:00').getTime();

function session(p: Partial<MeetingSession> = {}): MeetingSession {
  return {
    id: p.id ?? 's1',
    platform: 'google-meet',
    meetingCode: p.meetingCode ?? 'abc-defg-hij',
    title: p.title ?? 'Weekly sync',
    startedAt: p.startedAt ?? NOW,
    endedAt: p.endedAt ?? null,
    participants: p.participants ?? [],
    status: p.status ?? 'ended',
    ...(p.error === undefined ? {} : { error: p.error }),
  };
}

describe('dayLabel', () => {
  it('uses words for recent days', () => {
    expect(dayLabel(NOW, NOW)).toBe('Today');
    expect(dayLabel(NOW - DAY, NOW)).toBe('Yesterday');
  });

  it('names the weekday within the last week', () => {
    expect(dayLabel(NOW - 3 * DAY, NOW)).toMatch(/day$/);
  });

  it('falls back to a date once the weekday stops being useful', () => {
    expect(dayLabel(NOW - 30 * DAY, NOW)).toMatch(/\d/);
  });

  it('treats earlier the same morning as today', () => {
    const earlier = new Date('2026-08-17T02:00:00').getTime();
    expect(dayLabel(earlier, NOW)).toBe('Today');
  });
});

describe('groupByDay', () => {
  it('groups newest first, and newest within each day', () => {
    const groups = groupByDay(
      [
        session({ id: 'a', startedAt: NOW - DAY }),
        session({ id: 'b', startedAt: NOW - 3600_000 }),
        session({ id: 'c', startedAt: NOW }),
      ],
      NOW,
    );
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday']);
    expect(groups[0]!.sessions.map((s) => s.id)).toEqual(['c', 'b']);
  });

  it('returns nothing for an empty list', () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });
});

describe('search', () => {
  const s = session({ title: 'Pricing Discussion', meetingCode: 'xyz-abcd-efg' });
  const transcript = 'Ana: we should ship on friday\nBo: agreed';

  it('matches everything when the query is empty', () => {
    expect(matches(s, '', undefined)).toBe(true);
    expect(matches(s, '   ', undefined)).toBe(true);
  });

  it('matches the title case-insensitively', () => {
    expect(matches(s, 'pricing', undefined)).toBe(true);
    expect(matches(s, 'PRICING', undefined)).toBe(true);
  });

  it('matches the meeting code', () => {
    expect(matches(s, 'xyz-abcd', undefined)).toBe(true);
  });

  it('searches inside the transcript', () => {
    // The realistic query is "what did we say about X", not a calendar title.
    expect(matches(s, 'friday', transcript)).toBe(true);
  });

  it('does not search transcripts for very short queries', () => {
    // Two letters would match nearly every transcript ever recorded.
    const short = 'we'.slice(0, TRANSCRIPT_SEARCH_MIN - 1);
    expect(matches(s, short, transcript)).toBe(false);
  });

  it('returns false when nothing matches', () => {
    expect(matches(s, 'kubernetes', transcript)).toBe(false);
  });

  it('tolerates a transcript that has not loaded yet', () => {
    expect(matches(s, 'friday', undefined)).toBe(false);
  });
});

describe('durationMinutes', () => {
  it('is null while the meeting is still running', () => {
    expect(durationMinutes(session({ endedAt: null }))).toBeNull();
  });

  it('rounds to whole minutes', () => {
    expect(durationMinutes(session({ startedAt: 0, endedAt: 125_000 }))).toBe(2);
  });

  it('never reports a negative duration', () => {
    expect(durationMinutes(session({ startedAt: 5000, endedAt: 0 }))).toBe(0);
  });
});
