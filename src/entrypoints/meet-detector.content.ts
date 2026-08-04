import { parseMeetingCode, isBotTab } from '@/core/meet/meetingCode';
import { showJoinToast } from '@/entrypoints/meet-detector/toast';
import { SETTINGS_KEY } from '@/adapters/storage/ChromeSettingsStore';
import { DEFAULT_SETTINGS, type Settings } from '@/core/ports/SettingsStore';
import type { Message } from '@/shared/messaging/messages';

export default defineContentScript({
  matches: ['https://meet.google.com/*'],
  main() {
    // The bot's own tab must never trigger a second bot.
    if (isBotTab(location.href)) return;

    let announced: string | null = null;
    let dismissToast: (() => void) | null = null;

    const send = (m: Message): void => {
      void chrome.runtime.sendMessage(m);
    };

    const settings = async (): Promise<Settings> => {
      const raw = await chrome.storage.local.get(SETTINGS_KEY);
      return { ...DEFAULT_SETTINGS, ...(raw[SETTINGS_KEY] as Partial<Settings> | undefined) };
    };

    const leave = (): void => {
      if (announced === null) return;
      dismissToast?.();
      dismissToast = null;
      send({ type: 'USER_LEFT', meetingCode: announced });
      announced = null;
    };

    const check = async (): Promise<void> => {
      const code = parseMeetingCode(location.href);

      if (code !== null && code !== announced) {
        announced = code;
        const cfg = await settings();
        if (!cfg.autoJoin) return;
        dismissToast = showJoinToast(
          document,
          cfg.toastDelayMs,
          () => send({ type: 'JOIN_CANCELLED', meetingCode: code }),
          () =>
            send({
              type: 'MEETING_DETECTED',
              meetingCode: code,
              tabId: -1, // filled in by the background worker from sender.tab
              title: document.title || null,
            }),
        );
        return;
      }

      // Meet routes away from /xxx-yyyy-zzz on leave (spec §7.1).
      if (code === null && announced !== null) leave();
    };

    void check();

    // Meet is a SPA: it rewrites the URL on join and on leave.
    const push = history.pushState.bind(history);
    history.pushState = (...args: Parameters<typeof history.pushState>) => {
      push(...args);
      void check();
    };
    addEventListener('popstate', () => void check());
    setInterval(() => void check(), 2000);
    addEventListener('pagehide', leave);
  },
});
