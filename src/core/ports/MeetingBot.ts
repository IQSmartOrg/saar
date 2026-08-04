export type Unsubscribe = () => void;

export type EndReason =
  | 'user-left'
  | 'bot-removed'
  | 'meeting-ended'
  | 'tab-closed'
  | 'lobby-timeout'
  | 'error';

export interface JoinRequest {
  readonly sessionId: string;
  readonly meetingCode: string;
  readonly accountIndex: number;
  readonly displayNameHint?: string;
}

export interface JoinResult {
  readonly ok: boolean;
  readonly tabId?: number;
  readonly error?: string;
}

export interface MeetingBot {
  join(req: JoinRequest): Promise<JoinResult>;
  leave(): Promise<void>;
  onEnded(cb: (reason: EndReason) => void): Unsubscribe;
}
