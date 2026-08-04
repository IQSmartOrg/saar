import type { SourceHealth } from '@/core/ports/TranscriptSource';
import type { SessionStatus } from '@/core/types/session';
import type { TranscriptSegment } from '@/core/types/transcript';

export const PORT_NAME = 'saar-bot';

export type Message =
  | { type: 'MEETING_DETECTED'; meetingCode: string; tabId: number; title: string | null }
  | { type: 'JOIN_CANCELLED'; meetingCode: string }
  | { type: 'BOT_STATE'; sessionId: string; status: SessionStatus; detail?: string }
  | { type: 'SEGMENT_BATCH'; sessionId: string; segments: TranscriptSegment[] }
  | { type: 'SOURCE_HEALTH'; sessionId: string; health: SourceHealth }
  | { type: 'USER_LEFT'; meetingCode: string };

/** Makes every unhandled message variant a compile-time error. */
export function assertNever(x: never): never {
  throw new Error(`Unhandled message variant: ${JSON.stringify(x)}`);
}
