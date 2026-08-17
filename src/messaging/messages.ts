import type { SourceHealth } from '@/capture/TranscriptSource';
import type { SessionStatus } from '@/session/types';
import type { TranscriptSegment } from '@/capture/types';
import type { ImmediateStopReason } from '@/session/stopSignals';
import type { MomProgress } from '@/processing/mom/types';

/**
 * One row of "what Saar is doing right now".
 *
 * A single list rather than separate recording and processing queries, because
 * summarising begins when a meeting ENDS and therefore outlives it: a user can
 * be recording their 3pm while the 2pm is still being written up. Anything that
 * modelled one active thing could not express that.
 */
export type Activity =
  | {
      readonly kind: 'recording';
      readonly sessionId: string;
      readonly title: string;
      readonly startedAt: number;
      readonly lines: number;
    }
  | {
      readonly kind: 'processing';
      readonly sessionId: string;
      readonly title: string;
      readonly progress: MomProgress;
      /** Stopped by the user, holding everything summarised so far. */
      readonly paused: boolean;
    }
  | {
      readonly kind: 'ready';
      readonly sessionId: string;
      readonly title: string;
      readonly decisions: number;
      readonly actionItems: number;
    }
  | {
      readonly kind: 'failed';
      readonly sessionId: string;
      readonly title: string;
      readonly error: string;
    };

/**
 * Reachability and the available models in one round trip — the settings panel
 * always wants both: it cannot offer a model dropdown without the list, and a
 * list it could not fetch is exactly what "not connected" means.
 */
export interface LlmProbeResult {
  readonly ok: boolean;
  readonly models: readonly string[];
  readonly detail?: string;
  /** A local model rejected this extension's origin; there is a one-line fix. */
  readonly originBlocked?: boolean;
}

/**
 * What the user can do to a summarisation run that is already under way.
 *
 * Cancel throws the partial work away and puts the meeting back to being an
 * unsummarised transcript; pause keeps every chunk already written.
 */
export type MomAction = 'pause' | 'resume' | 'cancel';

export const PORT_NAME = 'saar-bot';

export type Message =
  | { type: 'MEETING_DETECTED'; meetingCode: string; tabId: number; title: string | null }
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
  /** Popup asks what Saar is doing right now — recording, summarising, or done. */
  | { type: 'ACTIVITY_QUERY' }
  /** Re-run summarisation for a meeting whose transcript is already saved. */
  | { type: 'RETRY_REQUESTED'; sessionId: string }
  /** Summarisation advanced a step. Broadcast; usually nobody is listening. */
  | { type: 'MOM_PROGRESS'; sessionId: string; progress: MomProgress }
  /** Pause, resume or abandon a run. Answers false when there is no job left. */
  | { type: 'MOM_CONTROL'; sessionId: string; action: MomAction }
  /** Test the configured endpoint and fetch its model list, for the dropdown. */
  | { type: 'LLM_PROBE' };
