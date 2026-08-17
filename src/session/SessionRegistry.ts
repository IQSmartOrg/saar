export interface ActiveSession {
  readonly sessionId: string;
  readonly meetingCode: string;
  readonly userTabId: number;
  readonly botTabId: number | null;
}

function normalise(raw: unknown): ActiveSession | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Partial<ActiveSession>;
  if (typeof row.sessionId !== 'string' || typeof row.meetingCode !== 'string') return null;
  return {
    sessionId: row.sessionId,
    meetingCode: row.meetingCode,
    userTabId: typeof row.userTabId === 'number' ? row.userTabId : -1,
    botTabId: typeof row.botTabId === 'number' ? row.botTabId : null,
  };
}

/**
 * Pure, serialisable registry of in-flight sessions.
 *
 * MV3 service workers terminate after ~30s idle, so this never lives only in
 * memory — the background worker persists it to `chrome.storage.session` and
 * rehydrates on wake. `fromJSON` therefore reads rows an older build wrote:
 * it validates rather than casts, because a shape that no longer matches would
 * otherwise surface as a crash somewhere far from here.
 */
export class SessionRegistry {
  constructor(private sessions: ActiveSession[] = []) {}

  static fromJSON(raw: unknown): SessionRegistry {
    if (!Array.isArray(raw)) return new SessionRegistry();
    return new SessionRegistry(raw.map(normalise).filter((x): x is ActiveSession => x !== null));
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

  bySessionId(id: string): ActiveSession | null {
    return this.sessions.find((x) => x.sessionId === id) ?? null;
  }

  /** Either tab closing ends the session, so both ids are searched. */
  byTabId(tabId: number): ActiveSession | null {
    return this.sessions.find((x) => x.userTabId === tabId || x.botTabId === tabId) ?? null;
  }
}
