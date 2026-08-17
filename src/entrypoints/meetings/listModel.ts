import type { MeetingSession } from '@/session/types';

/**
 * Pure list logic for the meetings page: how the list is grouped, what a search
 * matches, and how long a meeting ran.
 *
 * Separated from the DOM so the rules can be tested without a browser — these
 * are the parts where being wrong is invisible rather than obvious.
 */

/* ------------------------------------------------------------------ *
 * Grouping
 * ------------------------------------------------------------------ */

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Meetings are remembered by when they happened, so the list groups by day.
 * Recent days get a word rather than a date — nobody thinks of this morning's
 * standup as "17 Aug".
 */
export function dayLabel(startedAt: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(startedAt)) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return new Date(startedAt).toLocaleDateString(undefined, { weekday: 'long' });
  return new Date(startedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: startOfDay(now) - startOfDay(startedAt) > 300 * 86_400_000 ? 'numeric' : undefined,
  });
}

export interface DayGroup {
  readonly label: string;
  readonly sessions: readonly MeetingSession[];
}

/** Newest first, within newest-first days. */
export function groupByDay(
  sessions: readonly MeetingSession[],
  now: number = Date.now(),
): DayGroup[] {
  const ordered = [...sessions].sort((a, b) => b.startedAt - a.startedAt);
  const groups: DayGroup[] = [];

  for (const session of ordered) {
    const label = dayLabel(session.startedAt, now);
    const last = groups.at(-1);
    if (last?.label === label) {
      (last.sessions as MeetingSession[]).push(session);
    } else {
      groups.push({ label, sessions: [session] });
    }
  }
  return groups;
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

/** Below this, a query matches too much to be worth searching transcripts for. */
export const TRANSCRIPT_SEARCH_MIN = 3;

export function matchesTitle(session: MeetingSession, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return (
    (session.title ?? '').toLowerCase().includes(q) ||
    session.meetingCode.toLowerCase().includes(q)
  );
}

/**
 * The realistic query is "what did we say about pricing", not the name of a
 * calendar event — so search covers transcript text too, once the query is
 * long enough to be selective.
 */
export function matches(
  session: MeetingSession,
  query: string,
  transcript: string | undefined,
): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  if (matchesTitle(session, q)) return true;
  if (q.length < TRANSCRIPT_SEARCH_MIN || transcript === undefined) return false;
  return transcript.toLowerCase().includes(q);
}

export function durationMinutes(session: MeetingSession): number | null {
  if (session.endedAt === null) return null;
  return Math.max(0, Math.round((session.endedAt - session.startedAt) / 60_000));
}
