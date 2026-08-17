import type { MeetingSession } from '@/session/types';
import type { TranscriptSegment } from '@/capture/types';
import type { MeetingMinutes } from '@/minutes/types';

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
