import { isBotTab, parseMeetingCode } from '@/meet/meetingCode';
import { isInCall } from '@/meet/join';
import { HEARTBEAT_INTERVAL_MS, type ImmediateStopReason } from '@/session/stopSignals';
import { showJoinToast } from '@/ui/joinToast';
import { SETTINGS_KEY } from '@/settings/ChromeSettingsStore';
import { DEFAULT_SETTINGS, type Settings } from '@/settings/types';
import type { Message } from '@/messaging/messages';
import { logger } from '@/utils/logger';

const log = logger('agents.userTab');

/**
 * Runs in the user's OWN Meet tab.
 *
 * Its whole job is to answer two questions for the background worker: has this
 * person actually entered a call, and are they still in it. It never touches
 * the meeting — the notetaker does that from its own tab.
 */

/** How often the URL is re-checked. Meet is a SPA and does not always announce. */
const POLL_MS = 2000;

export function startUserTabAgent(): void {
  // The bot's own tab must never trigger a second bot.
  if (isBotTab(location.href)) return;

  let announced: string | null = null;
  let dismissToast: (() => void) | null = null;

  const send = (m: Message): void => {
    void chrome.runtime.sendMessage(m);
  };

  const readSettings = async (): Promise<Settings> => {
    const raw = await chrome.storage.local.get(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(raw[SETTINGS_KEY] as Partial<Settings> | undefined) };
  };

  const leave = (reason: ImmediateStopReason): void => {
    if (announced === null) return;
    dismissToast?.();
    dismissToast = null;
    log.info('the user left the call', { meetingCode: announced, reason });
    send({ type: 'USER_LEFT', meetingCode: announced, reason });
    announced = null;
  };

  /**
   * Signal 5. Positive proof that the user is still in the call, sent every
   * ~10s. The background worker stops the session when these go quiet, which is
   * what makes leaving detectable even when no event fires — a crash, a
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
      // A Meet URL matches /xxx-yyyy-zzz as soon as the pre-join screen loads,
      // so the code alone means "looking at a meeting", not "in one". Without
      // this gate the bot tab opened and joined while the user was still
      // sitting in the green room deciding whether to join at all.
      //
      // Deliberately not `return`-and-forget: `announced` stays null so the
      // poll re-checks, and we fire on the first tick after the user is in.
      if (!isInCall(document)) return;

      announced = code;
      log.info('the user is in a call', { meetingCode: code });
      const cfg = await readSettings();
      if (!cfg.autoJoin) {
        log.info('auto-join is off — not asking for a notetaker', { meetingCode: code });
        return;
      }
      dismissToast = showJoinToast(document, cfg.toastDelayMs, () =>
        send({
          type: 'MEETING_DETECTED',
          meetingCode: code,
          // Filled in by the background worker from sender.tab — a content
          // script cannot be trusted to name a tab it does not own.
          tabId: -1,
          title: document.title || null,
        }),
      );
      return;
    }

    // Meet routes away from /xxx-yyyy-zzz on leave.
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
  setInterval(() => void check(), POLL_MS);
  addEventListener('pagehide', () => leave('user-tab-hidden'));
}
