import type { MeetingSession } from '@/core/types/session';
import type { TranscriptSegment } from '@/core/types/transcript';

export interface TranscriptRepository {
  createSession(session: MeetingSession): Promise<void>;
  updateSession(id: string, patch: Partial<MeetingSession>): Promise<void>;
  getSession(id: string): Promise<MeetingSession | null>;
  listSessions(): Promise<readonly MeetingSession[]>;
  deleteSession(id: string): Promise<void>;
  appendSegments(id: string, segments: readonly TranscriptSegment[]): Promise<void>;
  getSegments(id: string): Promise<readonly TranscriptSegment[]>;
}
