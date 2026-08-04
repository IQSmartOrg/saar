export type SessionStatus =
  | 'joining'
  | 'in-lobby'
  | 'capturing'
  | 'ended'
  | 'summarizing'
  | 'complete'
  | 'failed';

export interface MeetingSession {
  readonly id: string;
  readonly platform: 'google-meet';
  readonly meetingCode: string;
  readonly title: string | null;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly participants: readonly string[];
  readonly status: SessionStatus;
  readonly error?: string;
}

export function newSessionId(): string {
  return crypto.randomUUID();
}
