export interface ActiveSession {
  readonly sessionId: string;
  readonly meetingCode: string;
  readonly userTabId: number;
  readonly botTabId: number | null;
}

/**
 * Pure, serialisable registry of in-flight sessions.
 *
 * MV3 service workers terminate after ~30s idle, so this never lives only in
 * memory — the background worker persists it to `chrome.storage.session` and
 * rehydrates on wake (spec §14).
 */
export class SessionRegistry {
  constructor(private sessions: ActiveSession[] = []) {}

  static fromJSON(raw: unknown): SessionRegistry {
    return new SessionRegistry(Array.isArray(raw) ? (raw as ActiveSession[]) : []);
  }

  toJSON(): ActiveSession[] {
    return [...this.sessions];
  }

  all(): readonly ActiveSession[] {
    return this.sessions;
  }

  add(s: ActiveSession): void {
    if (this.byMeetingCode(s.meetingCode)) return;
    this.sessions.push(s);
  }

  remove(sessionId: string): void {
    this.sessions = this.sessions.filter((x) => x.sessionId !== sessionId);
  }

  byMeetingCode(code: string): ActiveSession | null {
    return this.sessions.find((x) => x.meetingCode === code) ?? null;
  }

  byBotTab(tabId: number): ActiveSession | null {
    return this.sessions.find((x) => x.botTabId === tabId) ?? null;
  }

  bySessionId(id: string): ActiveSession | null {
    return this.sessions.find((x) => x.sessionId === id) ?? null;
  }
}
