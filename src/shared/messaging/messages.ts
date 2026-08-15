import type { SourceHealth } from '@/core/ports/TranscriptSource';
import type { SessionStatus } from '@/core/types/session';
import type { TranscriptSegment } from '@/core/types/transcript';
import type { ImmediateStopReason } from '@/core/session/stopSignals';

/** What the popup needs to render the Stop button. */
export interface ActiveSessionSummary {
  readonly sessionId: string;
  readonly meetingCode: string;
  readonly title: string | null;
  readonly startedAt: number;
}

export const PORT_NAME = 'saar-bot';

export type Message =
  | { type: 'MEETING_DETECTED'; meetingCode: string; tabId: number; title: string | null }
  | { type: 'JOIN_CANCELLED'; meetingCode: string }
  | { type: 'BOT_STATE'; sessionId: string; status: SessionStatus; detail?: string }
  | { type: 'SEGMENT_BATCH'; sessionId: string; segments: TranscriptSegment[] }
  | { type: 'SOURCE_HEALTH'; sessionId: string; health: SourceHealth }
  | { type: 'USER_LEFT'; meetingCode: string; reason: ImmediateStopReason }
  /** Signal 5: the user's tab proving every ~10s that it is still in the call. */
  | { type: 'USER_ALIVE'; meetingCode: string }
  /** Signal 7: the bot reporting whether it is still inside the call. */
  | { type: 'BOT_PRESENCE'; sessionId: string; inCall: boolean }
  /** Signal 8: Stop pressed in the popup. */
  | { type: 'STOP_REQUESTED'; sessionId: string }
  /** Popup asks what is currently recording. */
  | { type: 'ACTIVE_SESSIONS_QUERY' };

/** Makes every unhandled message variant a compile-time error. */
export function assertNever(x: never): never {
  throw new Error(`Unhandled message variant: ${JSON.stringify(x)}`);
}
