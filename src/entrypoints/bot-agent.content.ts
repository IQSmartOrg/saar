import { MeetCaptionScraper } from '@/adapters/meet/MeetCaptionScraper';
import { joinMeeting, isInCall } from '@/adapters/meet/join';
import { startCaptions } from '@/adapters/meet/captions';
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

    sendState('joining');

    // 1. Get into the meeting. joinMeeting mutes on every pass and will not
    //    click Join until it has confirmed the microphone and camera read as
    //    off — joining with a live mic is worse than not joining at all. It
    //    also waits patiently rather than failing fast, so a human clicking
    //    "Join now" themselves still gets us there.
    const entered = await joinMeeting(document, {
      timeoutMs: ENTER_TIMEOUT_MS,
      pollMs: ENTER_POLL_MS,
      onLobby: () => sendState('in-lobby'),
    });

    if (!entered.ok) {
      sendState('failed', entered.error);
      return;
    }

    // 2. Turn captions on, with backoff.
    const captions = await startCaptions(document, { retries: CAPTION_RETRIES });
    if (!captions.ok) {
      sendState('failed', captions.error);
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

    // start() returns silently when it cannot find the caption region, so the
    // health readout is the only proof an observer was actually attached.
    // Announcing 'capturing' without checking is how a meeting could report
    // itself as being recorded while capturing nothing at all.
    if (!scraper.health().selectorsMatched) {
      sendState('failed', 'caption region not found — nothing would be captured');
      batcher.dispose();
      port.disconnect();
      return;
    }

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

    // Belt-and-braces flush. The batcher already flushes every 2s, but that
    // timer only runs while captions keep arriving — and `pagehide` does not
    // fire on a crash, a force-quit, or a tab Chrome discards under memory
    // pressure. Flushing when the tab is hidden or frozen means the live
    // transcript is never more than a couple of seconds behind on disk.
    const flush = (): void => batcher.flushNow();
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
    addEventListener('freeze', flush);
    addEventListener('beforeunload', flush);

    const health = setInterval(() => {
      // Nothing should be pending this long, but a missed flush would strand
      // the tail of the meeting, so force one on every health tick.
      flush();
      send({ type: 'SOURCE_HEALTH', sessionId, health: scraper.health() });

      // Signal 7. The bot being ejected — removed by the host, or the meeting
      // ending for everyone — leaves it on a post-call screen where captions
      // simply stop. Reporting presence lets the background worker end the
      // session now instead of waiting out the stall timeout.
      send({ type: 'BOT_PRESENCE', sessionId, inCall: isInCall(document) });
    }, HEALTH_INTERVAL_MS);

    // Signal 4.
    addEventListener('pagehide', () => void teardown('ended'));
    port.onDisconnect.addListener(() => void scraper.stop());
  },
});
