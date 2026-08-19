import type { TranscriptRepository } from '@/storage/TranscriptRepository';
import type { SettingsStore } from '@/settings/types';
import type { JobStore } from '@/processing/job/JobStore';
import { MOM_ALARM, type MomRunner } from '@/processing/job/MomRunner';
import { PORT_NAME, type Message, type MomAction } from '@/messaging/messages';
import { assertNever } from '@/utils/assert';
import { ingest, logger } from '@/utils/logger';

const log = logger('background.routes');
import { buildActivity } from '@/background/activity';
import { notify } from '@/background/notify';
import { probeLlm } from '@/background/probeLlm';
import { SessionCoordinator, WATCHDOG_ALARM } from '@/background/SessionCoordinator';
import type { BackgroundState } from '@/background/state';

export interface Routes {
  readonly repo: TranscriptRepository;
  readonly settings: SettingsStore;
  readonly jobs: JobStore;
  readonly state: BackgroundState;
  readonly mom: MomRunner;
  readonly sessions: SessionCoordinator;
}

/**
 * Where every inbound event lands.
 *
 * Three transports, deliberately kept apart:
 *
 *   sendMessage  request/response from an extension page (popup, meetings)
 *   port         the high-volume stream from a bot tab; one connection per bot
 *   alarms/tabs  the browser telling us something happened
 *
 * Caption batches arrive tens of times a minute, which is exactly what a port
 * is for — routing them through sendMessage would wake the worker on every
 * revision of every caption block.
 */
export function registerRoutes(deps: Routes): void {
  registerMessages(deps);
  registerPort(deps);
  registerBrowserEvents(deps);
}

function registerMessages(deps: Routes): void {
  const { repo, settings, sessions, jobs, state, mom } = deps;

  chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
    // The three that answer. `return true` keeps the channel open for the
    // async reply; everything below it must not, or Chrome drops the port.
    switch (msg.type) {
      case 'ACTIVITY_QUERY':
        void buildActivity({ repo, jobs, state }).then(sendResponse);
        return true;
      case 'RETRY_REQUESTED':
        void mom.retry(msg.sessionId).then(sendResponse);
        return true;
      case 'LLM_PROBE':
        void probeLlm(settings).then(sendResponse);
        return true;
      case 'MOM_CONTROL':
        void runMomAction(mom, msg.sessionId, msg.action).then(sendResponse);
        return true;
      case 'LOG':
        // Extension pages log here as well as the bot tab, because the popup's
        // own console dies the moment the popup closes — which is exactly when
        // you want to read what it just did.
        ingest(msg.record, sender.tab === undefined ? 'ui' : 'page');
        return false;
      default:
        break;
    }

    void (async () => {
      switch (msg.type) {
        case 'MEETING_DETECTED':
          log.info('a meeting was detected', {
            meetingCode: msg.meetingCode,
            tabId: sender.tab?.id,
          });
          // The tab id comes from the sender, never from the message — a
          // content script cannot be trusted to name a tab it does not own.
          if (sender.tab?.id !== undefined) {
            await sessions.start(msg.meetingCode, sender.tab.id, msg.title);
          }
          break;

        // Signals 1 and 2 — the user's tab says it is done.
        case 'USER_LEFT':
          log.info('the user left', { meetingCode: msg.meetingCode, reason: msg.reason });
          await sessions.signalByCode(msg.meetingCode, msg.reason);
          break;

        // Signal 5 — liveness.
        case 'USER_ALIVE': {
          const registry = await state.loadRegistry();
          const entry = registry.byMeetingCode(msg.meetingCode);
          if (entry) {
            await sessions.withWatch(entry.sessionId, (w) => {
              w.heartbeat(Date.now());
              return null;
            });
          }
          break;
        }

        // Signal 8 — Stop pressed in the popup.
        case 'STOP_REQUESTED':
          log.info('stop pressed', { sessionId: msg.sessionId });
          await sessions.withWatch(msg.sessionId, (w) => w.signal('manual-stop'));
          break;

        case 'BOT_STATE':
        case 'SEGMENT_BATCH':
        case 'SOURCE_HEALTH':
        case 'BOT_PRESENCE':
          break; // these arrive over the port, not sendMessage
        case 'MOM_PROGRESS':
          break; // broadcast outward only
        default:
          assertNever(msg);
      }
    })();
    return false;
  });
}

function runMomAction(
  mom: MomRunner,
  sessionId: string,
  action: MomAction,
): Promise<boolean> {
  switch (action) {
    case 'pause':
      return mom.pause(sessionId);
    case 'resume':
      return mom.unpause(sessionId);
    case 'cancel':
      return mom.cancel(sessionId);
  }
}

function registerPort(deps: Routes): void {
  const { repo, sessions } = deps;

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;

    port.onMessage.addListener((msg: Message) => {
      void (async () => {
        switch (msg.type) {
          case 'SEGMENT_BATCH':
            await repo.appendSegments(msg.sessionId, msg.segments);
            // Feeds signal 9: fresh captions mean capture is alive.
            await sessions.withWatch(msg.sessionId, (w) => {
              w.segments(Date.now());
              return null;
            });
            break;

          // Signal 7 — the bot reporting whether it is still in the call.
          case 'BOT_PRESENCE':
            if (!msg.inCall) {
              await sessions.withWatch(msg.sessionId, (w) => w.signal('bot-not-in-call'));
            }
            break;

          case 'BOT_STATE':
            log.info('notetaker state', {
              sessionId: msg.sessionId,
              status: msg.status,
              detail: msg.detail,
            });
            await repo.updateSession(msg.sessionId, {
              status: msg.status,
              ...(msg.detail === undefined ? {} : { error: msg.detail }),
            });
            if (msg.status === 'capturing') {
              await sessions.withWatch(msg.sessionId, (w) => {
                w.captureStarted(Date.now());
                return null;
              });
            }
            // Signal 4 reaches here: the bot tab tears down and reports 'ended'.
            if (msg.status === 'ended' || msg.status === 'failed') {
              await sessions.withWatch(msg.sessionId, (w) => w.signal('bot-tab-hidden'));
              await sessions.end(msg.sessionId);
            }
            break;

          case 'LOG':
            // Re-emitted here so the worker's console is the single place to
            // watch. `ingest` tags it so a forwarded record is distinguishable
            // from one the worker produced itself.
            ingest(msg.record, 'bot');
            break;

          case 'SOURCE_HEALTH':
            if (!msg.health.selectorsMatched) {
              log.severe('caption selectors are not matching', { sessionId: msg.sessionId });
              await notify(
                'Saar: captions not detected',
                "Meet's caption DOM may have changed — the transcript will be empty.",
              );
            }
            break;

          default:
            break;
        }
      })();
    });
  });
}

function registerBrowserEvents(deps: Routes): void {
  const { sessions, mom } = deps;

  // Signal 3.
  chrome.tabs.onRemoved.addListener((tabId) => {
    log.debug('a tab closed', { tabId });
    void sessions.signalByTab(tabId);
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === MOM_ALARM) {
      void mom.step();
      return;
    }
    if (alarm.name === WATCHDOG_ALARM) {
      void sessions.runWatchdog();
    }
  });
}
