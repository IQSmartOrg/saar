import { CaptionScraper } from '@/meet/CaptionScraper';
import { startCaptions } from '@/meet/captions';
import { isInCall, joinMeeting } from '@/meet/join';
import { isBotTab } from '@/meet/meetingCode';
import { DEFAULT_BATCHER_OPTIONS, SegmentBatcher } from '@/capture/SegmentBatcher';
import { SystemClock } from '@/utils/clock';
import { SystemScheduler } from '@/utils/scheduler';
import { PORT_NAME, type Message } from '@/messaging/messages';

/**
 * Runs in the NOTETAKER's Meet tab: join muted, turn captions on, stream them
 * back to the background worker.
 *
 * Everything it knows about Meet comes from `src/meet`, which is chrome-free —
 * so the same sequence runs unchanged under Puppeteer for the cloud build.
 */

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

export async function startNotetakerAgent(): Promise<void> {
  if (!isBotTab(location.href)) return;

  const sessionId = new URL(location.href).searchParams.get('saarSession');
  if (sessionId === null) return;

  const port = chrome.runtime.connect({ name: PORT_NAME });
  const send = (m: Message): void => port.postMessage(m);
  const sendState = (status: BotStatus, detail?: string): void => {
    send({ type: 'BOT_STATE', sessionId, status, detail });
  };

  sendState('joining');

  // 1. Get in. joinMeeting mutes on every pass and will not click Join until it
  //    has confirmed the microphone and camera read as off — joining with a
  //    live mic is worse than not joining at all. It also waits patiently
  //    rather than failing fast, so a human clicking "Join now" themselves
  //    still gets us there.
  const entered = await joinMeeting(document, {
    timeoutMs: ENTER_TIMEOUT_MS,
    pollMs: ENTER_POLL_MS,
    onLobby: () => sendState('in-lobby'),
  });
  if (!entered.ok) {
    sendState('failed', entered.error);
    return;
  }

  // 2. Turn captions on, with backoff. Returns only once the caption region is
  //    genuinely in the DOM, not merely once the button was clicked.
  const captions = await startCaptions(document, { retries: CAPTION_RETRIES });
  if (!captions.ok) {
    sendState('failed', captions.error);
    return;
  }

  // 3. Scrape, batching so a caption revised twenty times a second does not
  //    become twenty IndexedDB writes.
  const batcher = new SegmentBatcher(
    (segments) => send({ type: 'SEGMENT_BATCH', sessionId, segments }),
    DEFAULT_BATCHER_OPTIONS,
    SystemScheduler,
  );
  const scraper = new CaptionScraper(document, SystemClock);
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

  // Belt-and-braces flush. The batcher already flushes every 2s, but that timer
  // only runs while captions keep arriving — and `pagehide` does not fire on a
  // crash, a force-quit, or a tab Chrome discards under memory pressure.
  // Flushing when the tab is hidden or frozen means the live transcript is
  // never more than a couple of seconds behind on disk.
  const flush = (): void => batcher.flushNow();
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  addEventListener('freeze', flush);
  addEventListener('beforeunload', flush);

  const health = setInterval(() => {
    // Nothing should be pending this long, but a missed flush would strand the
    // tail of the meeting, so force one on every health tick.
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
}
