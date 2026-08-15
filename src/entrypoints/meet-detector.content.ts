import { parseMeetingCode, isBotTab } from '@/core/meet/meetingCode';
import { isInCall } from '@/adapters/meet/join';
import {
  HEARTBEAT_INTERVAL_MS,
  type ImmediateStopReason,
} from '@/core/session/stopSignals';
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

    const leave = (reason: ImmediateStopReason): void => {
      if (announced === null) return;
      dismissToast?.();
      dismissToast = null;
      send({ type: 'USER_LEFT', meetingCode: announced, reason });
      announced = null;
    };

    /**
     * Signal 5. Positive proof that the user is still in the call, sent every
     * ~10s. The background worker stops the session when these go quiet, which
     * is what makes leaving detectable even when no event fires — a crash, a
     * force-quit, the laptop sleeping, or Meet simply not changing the URL.
     */
    setInterval(() => {
      if (announced !== null && isInCall(document)) {
        send({ type: 'USER_ALIVE', meetingCode: announced });
      }
    }, HEARTBEAT_INTERVAL_MS);

    const check = async (): Promise<void> => {
      const code = parseMeetingCode(location.href);

      if (code !== null && code !== announced) {
        // A Meet URL matches /xxx-yyyy-zzz as soon as the pre-join screen
        // loads, so the code alone means "looking at a meeting", not "in one".
        // Without this gate the bot tab opened and joined while the user was
        // still sitting in the green room deciding whether to join at all.
        //
        // Deliberately not `return`-and-forget: `announced` stays null so the
        // 2s poll re-checks, and we fire on the first tick after the user is
        // actually in.
        if (!isInCall(document)) return;

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
      if (code === null && announced !== null) leave('user-left-meeting');
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
    addEventListener('pagehide', () => leave('user-tab-hidden'));
  },
});
