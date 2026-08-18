import type { JoinRequest, JoinResult, MeetingBot } from '@/bot/MeetingBot';
import { botTabUrl } from '@/meet/meetingCode';

/**
 * The notetaker as a muted tab in its own unfocused window.
 *
 * A window rather than a background tab, and this is the whole reason the bot
 * works at all. A hidden tab does not render: `requestAnimationFrame` never
 * fires there and Chrome throttles its timers, so Meet — a rAF-driven UI —
 * leaves its DOM frozen. The pre-join controls never reach the state the safety
 * gate waits for, and the caption region is never mutated, so the scraper's
 * MutationObserver never fires. Our own polling keeps running, which makes the
 * bot look alive while it reads a page that stopped updating. Both symptoms
 * cleared the instant someone clicked onto the tab.
 *
 * Chrome calls a tab visible when it is the active tab of a window that is not
 * minimized. Crucially the window does NOT need focus — so `focused: false`
 * gives us a rendering tab that never steals the user's keyboard or cursor.
 *
 * The cost is honest: a window is on screen. Minimizing it re-hides the tab and
 * breaks capture again, which is counterintuitive enough to be worth saying out
 * loud in the UI one day.
 */

/**
 * Big enough that Meet renders its desktop layout. Below roughly this, Meet
 * switches to a compact layout with different controls, and every selector in
 * meet/controls.ts is written against the desktop one.
 */
export const BOT_WINDOW = { width: 1024, height: 768 } as const;

export class ChromeTabBot implements MeetingBot {
  private tabId: number | null = null;
  private windowId: number | null = null;

  async join(req: JoinRequest): Promise<JoinResult> {
    try {
      const url = botTabUrl(req.meetingCode, req.accountIndex, req.sessionId);

      const win = await chrome.windows.create({
        url,
        focused: false,
        type: 'popup',
        width: BOT_WINDOW.width,
        height: BOT_WINDOW.height,
      });

      const tab = win?.tabs?.[0];
      if (win?.id === undefined || tab?.id === undefined) {
        return { ok: false, error: 'could not open the notetaker window' };
      }

      this.windowId = win.id;
      this.tabId = tab.id;

      // Mute before any media can start — otherwise the notetaker plays meeting
      // audio out the speakers, the user's mic picks it up, and it re-enters the
      // meeting as a feedback loop. Muting is output only; it does not affect
      // whether the tab renders.
      await chrome.tabs.update(tab.id, { muted: true });

      return { ok: true, tabId: tab.id };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Idempotent: closing an already-closed window is not an error. */
  async leave(): Promise<void> {
    const windowId = this.windowId;
    const tabId = this.tabId;
    this.windowId = null;
    this.tabId = null;

    if (windowId !== null) {
      try {
        await chrome.windows.remove(windowId);
        return;
      } catch {
        /* already gone; fall through to the tab, in case only the window died */
      }
    }
    if (tabId !== null) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        /* already gone */
      }
    }
  }
}
