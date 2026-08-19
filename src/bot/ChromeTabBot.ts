import type { JoinRequest, JoinResult, MeetingBot } from '@/bot/MeetingBot';
import { botTabUrl } from '@/meet/meetingCode';
import { logger } from '@/utils/logger';

const log = logger('bot.chromeTab');

/**
 * The notetaker as a muted background tab.
 *
 * A background tab, deliberately, after trying the alternative: giving it its
 * own unfocused window did NOT make it render. Chrome's occlusion tracking
 * counts a window entirely covered by another as hidden, so a window opened
 * behind a maximized Chrome is throttled exactly like a background tab — it
 * just also puts a window on the user's screen for nothing.
 *
 * What actually keeps it rendering is the MAIN-world content script in
 * entrypoints/keep-rendering.content.ts, which is why this can stay the
 * least intrusive option.
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
      log.info('opening the notetaker tab', { meetingCode: req.meetingCode, accountIndex: req.accountIndex });
      const tab = await chrome.tabs.create({ url, active: false });
      if (tab.id === undefined) return { ok: false, error: 'tab has no id' };

      this.tabId = tab.id;
      // Mute before any media can start — otherwise the bot tab plays meeting
      // audio out the speakers, the user's mic picks it up, and it re-enters
      // the meeting as a feedback loop.
      await chrome.tabs.update(tab.id, { muted: true });
      return { ok: true, tabId: tab.id };
    } catch (e) {
      log.severe('could not open the notetaker tab', { error: e });
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Idempotent: closing an already-closed tab is not an error. */
  async leave(): Promise<void> {
    const id = this.tabId;
    this.tabId = null;
    log.info('closing the notetaker tab', { tabId: id });
    if (id === null) return;
    try {
      await chrome.tabs.remove(id);
    } catch {
      /* already gone */
    }
  }
}
