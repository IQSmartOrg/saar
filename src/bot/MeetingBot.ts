/**
 * The seam in front of "put a notetaker in this meeting".
 *
 * A port, not an abstraction for its own sake: the Chrome build opens a tab
 * (ChromeTabBot), and the planned cloud build drives a headless browser
 * instead. Everything upstream — the background worker — talks only to this
 * shape, so swapping the two is a change at the composition root and nowhere
 * else.
 */
export interface JoinRequest {
  readonly sessionId: string;
  readonly meetingCode: string;
  readonly accountIndex: number;
}

export interface JoinResult {
  readonly ok: boolean;
  readonly tabId?: number;
  readonly error?: string;
}

export interface MeetingBot {
  join(req: JoinRequest): Promise<JoinResult>;
  leave(): Promise<void>;
}
