import type { JoinRequest, JoinResult, MeetingBot } from '@/bot/MeetingBot';
import { botTabUrl } from '@/meet/meetingCode';

/**
 * The notetaker as a muted background tab.
 *
 * The only file in the bot module that touches `chrome.*` — which is the point:
 * the cloud build replaces this one class with a Puppeteer driver and reuses
 * everything in `src/meet` unchanged.
 */
export class ChromeTabBot implements MeetingBot {
  private tabId: number | null = null;

  async join(req: JoinRequest): Promise<JoinResult> {
    try {
      const url = botTabUrl(req.meetingCode, req.accountIndex, req.sessionId);
      const tab = await chrome.tabs.create({ url, active: false });
      if (tab.id === undefined) return { ok: false, error: 'tab has no id' };

      this.tabId = tab.id;
      // Mute before any media can start — otherwise the bot tab plays meeting
      // audio out the speakers, the user's mic picks it up, and it re-enters
      // the meeting as a feedback loop.
      await chrome.tabs.update(tab.id, { muted: true });
      return { ok: true, tabId: tab.id };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Idempotent: closing an already-closed tab is not an error. */
  async leave(): Promise<void> {
    const id = this.tabId;
    this.tabId = null;
    if (id === null) return;
    try {
      await chrome.tabs.remove(id);
    } catch {
      /* already gone */
    }
  }
}
