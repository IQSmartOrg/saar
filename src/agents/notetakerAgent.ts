import { CaptionScraper } from '@/meet/CaptionScraper';
import { startCaptions } from '@/meet/captions';
import { inspectControls, isInCall, joinMeeting } from '@/meet/join';
import { isBotTab } from '@/meet/meetingCode';
import { DEFAULT_BATCHER_OPTIONS, SegmentBatcher } from '@/capture/SegmentBatcher';
import { SystemClock } from '@/utils/clock';
import { SystemScheduler } from '@/utils/scheduler';
import { addSink, logger } from '@/utils/logger';
import { PORT_NAME, type Message } from '@/messaging/messages';

/**
 * Runs in the NOTETAKER's Meet tab: join muted, turn captions on, stream them
 * back to the background worker.
 *
 * Everything it knows about Meet comes from `src/meet`, which is chrome-free —
 * so the same sequence runs unchanged under Puppeteer for the cloud build.
 */

const ENTER_POLL_MS = 2000;
const DIAG_INTERVAL_MS = 5000;
const CAPTION_RETRIES = 5;
const HEALTH_INTERVAL_MS = 30_000;

const log = logger('agents.notetaker');

type BotStatus = 'joining' | 'in-lobby' | 'capturing' | 'ended' | 'failed';

export async function startNotetakerAgent(): Promise<void> {
  if (!isBotTab(location.href)) return;

  const sessionId = new URL(location.href).searchParams.get('saarSession');
  if (sessionId === null) {
    log.warning('bot tab carries no saarSession — serving no session');
    return;
  }

  const port = chrome.runtime.connect({ name: PORT_NAME });
  const send = (m: Message): void => port.postMessage(m);
  const sendState = (status: BotStatus, detail?: string): void => {
    send({ type: 'BOT_STATE', sessionId, status, detail });
  };

  // Everything logged from here also reaches the worker's console — the only
  // one readable without clicking onto this tab, and clicking onto it changes
  // how Chrome renders it, which is usually what is being diagnosed.
  addSink((record) => {
    try {
      send({ type: 'LOG', record });
    } catch {
      // The port closes when the meeting ends; losing a line then is fine.
    }
  });

  log.info('notetaker starting', {
    sessionId,
    // The real value: this script runs in the isolated world, so it is
    // unaffected by the visibility spoof keep-rendering applies to Meet.
    visibility: document.visibilityState,
  });
  sendState('joining');

  // Reported until we are in, so a stalled join says why rather than merely
  // timing out.
  const diag = setInterval(() => {
    const { controls, mute } = inspectControls(document);
    log.debug('page state', {
      visibility: document.visibilityState,
      controls: controls.map((c) => `${c.control}:${c.matchedBy}`).join(' '),
      mic: mute.mic,
      camera: mute.camera,
    });
  }, DIAG_INTERVAL_MS);

  // 1. Get in. joinMeeting mutes on every pass and will not click Join until it
  //    has confirmed the microphone and camera read as off — joining with a
  //    live mic is worse than not joining at all. It also waits patiently
  //    rather than failing fast, so a human clicking "Join now" themselves
  //    still gets us there.
  // Budgets are per stage and live in meet/join.ts — see DEFAULT_JOIN_BUDGETS.
  const entered = await joinMeeting(document, {
    pollMs: ENTER_POLL_MS,
    onLobby: () => {
      log.info('queued for admission');
      sendState('in-lobby');
    },
    onState: (state) => log.info('join stage', { stage: state }),
  });

  // How long each stage actually took, in the tab it actually runs in. This is
  // a hidden tab whose rendering Chrome deprioritizes, so the budgets above are
  // guesses until someone reads these numbers off a real meeting.
  clearInterval(diag);

  const stages = entered.visited.map((v) => `${v.state} ${Math.round(v.ms / 1000)}s`).join(' → ');
  const controls = entered.report.map((r) => `${r.control}:${r.matchedBy}`).join(' ');

  if (!entered.ok) {
    log.severe('could not get into the meeting', {
      reason: entered.error,
      stages,
      controls,
      needsAdmission: entered.needsAdmission,
    });
    sendState('failed', entered.error);
    return;
  }

  // The stage timings are where the budgets in meet/join.ts should come from,
  // and the resolver layers show DOM drift before it breaks anything.
  log.info('in the meeting', { stages, controls, wasInLobby: entered.wasInLobby });

  // 2. Turn captions on, with backoff. Returns only once the caption region is
  //    genuinely in the DOM, not merely once the button was clicked.
  const captions = await startCaptions(document, { retries: CAPTION_RETRIES });
  if (!captions.ok) {
    log.severe('captions never came on', {
      reason: captions.error,
      attempts: captions.attempts,
      matchedBy: captions.matchedBy,
    });
    sendState('failed', captions.error);
    return;
  }
  log.info('captions on', { attempts: captions.attempts, matchedBy: captions.matchedBy });

  // 3. Scrape, batching so a caption revised twenty times a second does not
  //    become twenty IndexedDB writes.
  const batcher = new SegmentBatcher(
    (segments) => {
      log.debug('flushing segments', { count: segments.length });
      send({ type: 'SEGMENT_BATCH', sessionId, segments });
    },
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
    const why = 'caption region not found — nothing would be captured';
    log.severe(why);
    sendState('failed', why);
    batcher.dispose();
    port.disconnect();
    return;
  }

  log.info('capturing');
  sendState('capturing');

  let torndown = false;
  const teardown = async (status: 'ended' | 'failed'): Promise<void> => {
    if (torndown) return;
    torndown = true;
    log.info('tearing down', { status, segments: scraper.health().segmentsSeen });
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
    const state = scraper.health();
    log.debug('health', {
      segments: state.segmentsSeen,
      lastSegmentAt: state.lastSegmentAt,
      selectorsMatched: state.selectorsMatched,
    });
    if (!state.selectorsMatched) log.warning('caption selectors stopped matching');
    send({ type: 'SOURCE_HEALTH', sessionId, health: state });

    // Signal 7. The bot being ejected — removed by the host, or the meeting
    // ending for everyone — leaves it on a post-call screen where captions
    // simply stop. Reporting presence lets the background worker end the
    // session now instead of waiting out the stall timeout.
    const inCall = isInCall(document);
    if (!inCall) log.warning('no longer in the call');
    send({ type: 'BOT_PRESENCE', sessionId, inCall });
  }, HEALTH_INTERVAL_MS);

  // Signal 4.
  addEventListener('pagehide', () => void teardown('ended'));
  port.onDisconnect.addListener(() => void scraper.stop());
}
