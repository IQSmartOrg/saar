import type { MeetingSession } from '@/core/types/session';
import type { TranscriptSegment } from '@/core/types/transcript';
import type { MeetingMinutes } from '@/core/types/minutes';

export interface TranscriptRepository {
  createSession(session: MeetingSession): Promise<void>;
  updateSession(id: string, patch: Partial<MeetingSession>): Promise<void>;
  getSession(id: string): Promise<MeetingSession | null>;
  listSessions(): Promise<readonly MeetingSession[]>;
  deleteSession(id: string): Promise<void>;
  appendSegments(id: string, segments: readonly TranscriptSegment[]): Promise<void>;
  getSegments(id: string): Promise<readonly TranscriptSegment[]>;
  saveMinutes(id: string, minutes: MeetingMinutes): Promise<void>;
  getMinutes(id: string): Promise<MeetingMinutes | null>;
  /** Ids that have minutes — one round trip, for rendering a list of statuses. */
  listMinutesIds(): Promise<readonly string[]>;
}
