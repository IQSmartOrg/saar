import { ChromeTabBot } from '@/adapters/bot/ChromeTabBot';
import { IndexedDbTranscriptRepository } from '@/adapters/storage/IndexedDbTranscriptRepository';
import { ChromeSettingsStore } from '@/adapters/storage/ChromeSettingsStore';
import { SessionRegistry, type ActiveSession } from '@/core/session/sessionState';
import { newSessionId } from '@/core/types/session';
import { PORT_NAME, assertNever, type Message } from '@/shared/messaging/messages';

const STATE_KEY = 'saar:sessions';

export default defineBackground(() => {
  // Composition root: the only place concrete adapters are constructed.
  const repo = new IndexedDbTranscriptRepository();
  const settings = new ChromeSettingsStore();
  const bots = new Map<string, ChromeTabBot>();

  async function loadRegistry(): Promise<SessionRegistry> {
    const raw = await chrome.storage.session.get(STATE_KEY);
    return SessionRegistry.fromJSON(raw[STATE_KEY]);
  }

  async function saveRegistry(r: SessionRegistry): Promise<void> {
    await chrome.storage.session.set({ [STATE_KEY]: r.toJSON() });
  }

  async function notify(title: string, message: string): Promise<void> {
    try {
      await chrome.notifications.create({
        type: 'basic',
        iconUrl: '/icon-128.png',
        title,
        message,
      });
    } catch {
      /* notifications are best-effort */
    }
  }

  async function startSession(
    code: string,
    userTabId: number,
    title: string | null,
  ): Promise<void> {
    const reg = await loadRegistry();
    if (reg.byMeetingCode(code)) return; // idempotent

    const cfg = await settings.get();
    if (cfg.botAccountIndex === null) {
      await notify('Saar needs setup', 'Choose the notetaker Google account in the Saar popup.');
      return;
    }

    const sessionId = newSessionId();
    await repo.createSession({
      id: sessionId,
      platform: 'google-meet',
      meetingCode: code,
      title,
      startedAt: Date.now(),
      endedAt: null,
      participants: [],
      status: 'joining',
    });

    // Go through the MeetingBot port, never chrome.tabs directly — this port is
    // what PuppeteerBot replaces in the cloud build (spec §18).
    const bot = new ChromeTabBot();
    bots.set(sessionId, bot);
    const result = await bot.join({
      sessionId,
      meetingCode: code,
      accountIndex: cfg.botAccountIndex,
    });
    if (!result.ok) {
      await repo.updateSession(sessionId, { status: 'failed', error: result.error });
      bots.delete(sessionId);
      return;
    }

    const entry: ActiveSession = {
      sessionId,
      meetingCode: code,
      userTabId,
      botTabId: result.tabId ?? null,
    };
    reg.add(entry);
    await saveRegistry(reg);
  }

  async function endSession(sessionId: string): Promise<void> {
    const reg = await loadRegistry();
    const entry = reg.bySessionId(sessionId);
    if (!entry) return; // idempotent — several signals converge here

    reg.remove(sessionId);
    await saveRegistry(reg);

    // Prefer the bot's own leave(). After a service-worker restart the
    // in-memory bot is gone, so fall back to the tab id we persisted.
    const bot = bots.get(sessionId);
    if (bot) {
      await bot.leave();
    } else if (entry.botTabId !== null) {
      try {
        await chrome.tabs.remove(entry.botTabId);
      } catch {
        /* already gone */
      }
    }
    bots.delete(sessionId);

    const current = await repo.getSession(sessionId);
    const label = current?.title ?? entry.meetingCode;

    if (current?.status === 'failed') {
      // Never report a failure as a success — say what actually went wrong.
      await notify('Saar could not record this meeting', current.error ?? label);
      return;
    }

    await repo.updateSession(sessionId, { status: 'ended', endedAt: Date.now() });
    const segments = await repo.getSegments(sessionId);
    const captured = segments.filter((s) => s.final).length;
    await notify(
      captured > 0 ? 'Transcript saved' : 'Meeting ended — nothing captured',
      captured > 0 ? `${label} · ${captured} lines` : label,
    );
  }

  chrome.runtime.onMessage.addListener((msg: Message, sender) => {
    void (async () => {
      switch (msg.type) {
        case 'MEETING_DETECTED':
          if (sender.tab?.id !== undefined) {
            await startSession(msg.meetingCode, sender.tab.id, msg.title);
          }
          break;
        case 'USER_LEFT': {
          const reg = await loadRegistry();
          const entry = reg.byMeetingCode(msg.meetingCode);
          if (entry) await endSession(entry.sessionId);
          break;
        }
        case 'JOIN_CANCELLED':
          break;
        case 'BOT_STATE':
        case 'SEGMENT_BATCH':
        case 'SOURCE_HEALTH':
          break; // these arrive over the port, not sendMessage
        default:
          assertNever(msg);
      }
    })();
    return false;
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;

    port.onMessage.addListener((msg: Message) => {
      void (async () => {
        switch (msg.type) {
          case 'SEGMENT_BATCH':
            await repo.appendSegments(msg.sessionId, msg.segments);
            break;
          case 'BOT_STATE':
            await repo.updateSession(msg.sessionId, {
              status: msg.status,
              ...(msg.detail === undefined ? {} : { error: msg.detail }),
            });
            if (msg.status === 'ended' || msg.status === 'failed') {
              await endSession(msg.sessionId);
            }
            break;
          case 'SOURCE_HEALTH':
            if (!msg.health.selectorsMatched) {
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

  // Belt-and-braces user-left signal: any single signal can be missed if the
  // service worker was asleep, so all of them converge on endSession, which is
  // idempotent (spec §7.1).
  chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      const reg = await loadRegistry();
      const entry = reg.all().find((x) => x.userTabId === tabId || x.botTabId === tabId);
      if (entry) await endSession(entry.sessionId);
    })();
  });
});
