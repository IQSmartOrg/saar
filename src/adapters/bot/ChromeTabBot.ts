import type {
  EndReason,
  JoinRequest,
  JoinResult,
  MeetingBot,
  Unsubscribe,
} from '@/core/ports/MeetingBot';

export function buildMeetUrl(code: string, accountIndex: number): string {
  return `https://meet.google.com/${code}?authuser=${accountIndex}`;
}

export class ChromeTabBot implements MeetingBot {
  private tabId: number | null = null;
  private listeners = new Set<(r: EndReason) => void>();

  private onRemoved = (tabId: number): void => {
    if (tabId === this.tabId) {
      this.tabId = null;
      this.fire('tab-closed');
    }
  };

  async join(req: JoinRequest): Promise<JoinResult> {
    try {
      // saarSession tells the bot-agent content script which session it serves.
      const url = `${buildMeetUrl(req.meetingCode, req.accountIndex)}&saarSession=${req.sessionId}`;
      const tab = await chrome.tabs.create({ url, active: false });
      if (tab.id === undefined) return { ok: false, error: 'tab has no id' };

      this.tabId = tab.id;
      // Mute before any media can start — otherwise the bot tab plays meeting
      // audio out the speakers, the user's mic picks it up, and it re-enters
      // the meeting as a feedback loop (spec §4.2).
      await chrome.tabs.update(tab.id, { muted: true });
      chrome.tabs.onRemoved.addListener(this.onRemoved);
      return { ok: true, tabId: tab.id };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async leave(): Promise<void> {
    const id = this.tabId;
    this.tabId = null;
    chrome.tabs.onRemoved.removeListener(this.onRemoved);
    if (id !== null) {
      try {
        await chrome.tabs.remove(id);
      } catch {
        /* already gone */
      }
    }
  }

  onEnded(cb: (reason: EndReason) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private fire(reason: EndReason): void {
    for (const l of this.listeners) l(reason);
  }
}
