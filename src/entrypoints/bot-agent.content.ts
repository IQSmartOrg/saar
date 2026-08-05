import { MeetCaptionScraper } from '@/adapters/meet/MeetCaptionScraper';
import { MeetJoinAutomation } from '@/adapters/meet/MeetJoinAutomation';
import { SegmentBatcher, DEFAULT_BATCHER_OPTIONS } from '@/core/capture/SegmentBatcher';
import { SystemClock } from '@/core/ports/Clock';
import { SystemScheduler } from '@/core/ports/Scheduler';
import { isBotTab } from '@/core/meet/meetingCode';
import { PORT_NAME, type Message } from '@/shared/messaging/messages';

/**
 * Covers the whole path into the meeting: pre-join screen, clicking join, and
 * waiting in the lobby to be admitted. One patient budget rather than separate
 * short ones, so a human clicking "Join now" manually still works.
 */
const ENTER_TIMEOUT_MS = 180_000;
const ENTER_POLL_MS = 2000;
const CAPTION_RETRIES = 5;
const HEALTH_INTERVAL_MS = 30_000;
/** Backstop: an orphaned bot in an empty meeting ends itself (spec §7.1). */
const IDLE_END_MS = 900_000;

type BotStatus = 'joining' | 'in-lobby' | 'capturing' | 'ended' | 'failed';

export default defineContentScript({
  matches: ['https://meet.google.com/*'],
  async main() {
    if (!isBotTab(location.href)) return;

    const sessionId = new URL(location.href).searchParams.get('saarSession');
    if (sessionId === null) return;

    const port = chrome.runtime.connect({ name: PORT_NAME });
    const send = (m: Message): void => port.postMessage(m);
    const sendState = (status: BotStatus, detail?: string): void => {
      send({ type: 'BOT_STATE', sessionId, status, detail });
    };

    const join = new MeetJoinAutomation(document);
    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

    sendState('joining');

    // 1. Get into the meeting. Each pass mutes, tries to click join, and checks
    //    whether we are in yet — so if clickJoin() cannot find the button, a
    //    human clicking it themselves still gets us there.
    const enterDeadline = Date.now() + ENTER_TIMEOUT_MS;
    let inCall = false;
    let announcedLobby = false;

    while (Date.now() < enterDeadline) {
      if (join.isInCall()) {
        inCall = true;
        break;
      }
      await join.muteMicAndCamera();
      if (join.isInLobby()) {
        if (!announcedLobby) {
          sendState('in-lobby');
          announcedLobby = true;
        }
      } else {
        await join.clickJoin();
      }
      await sleep(ENTER_POLL_MS);
    }

    if (!inCall) {
      sendState(
        'failed',
        announcedLobby
          ? 'not admitted from the lobby within 3 minutes'
          : 'could not get into the meeting within 3 minutes',
      );
      return;
    }

    // 2. Turn captions on, with backoff.
    let captionsOn = false;
    for (let attempt = 0; attempt < CAPTION_RETRIES; attempt++) {
      captionsOn = await join.enableCaptions();
      if (captionsOn) break;
      await sleep(1000 * 2 ** attempt);
    }
    if (!captionsOn) {
      sendState('failed', 'captions control not found');
      return;
    }

    // 4. Scrape.
    const batcher = new SegmentBatcher(
      (segments) => send({ type: 'SEGMENT_BATCH', sessionId, segments }),
      DEFAULT_BATCHER_OPTIONS,
      SystemScheduler,
    );
    const scraper = new MeetCaptionScraper(document, SystemClock);
    await scraper.start(batcher);
    sendState('capturing');

    let torndown = false;
    const teardown = async (status: 'ended' | 'failed'): Promise<void> => {
      if (torndown) return;
      torndown = true;
      clearInterval(health);
      await scraper.stop();
      batcher.dispose();
      sendState(status);
      port.disconnect();
    };

    const health = setInterval(() => {
      const h = scraper.health();
      send({ type: 'SOURCE_HEALTH', sessionId, health: h });
      const idle = h.lastSegmentAt !== null && Date.now() - h.lastSegmentAt > IDLE_END_MS;
      if (idle && join.participantCount() <= 1) void teardown('ended');
    }, HEALTH_INTERVAL_MS);

    addEventListener('pagehide', () => void teardown('ended'));
    port.onDisconnect.addListener(() => void scraper.stop());
  },
});
