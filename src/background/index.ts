import { IndexedDbTranscriptRepository } from '@/storage/IndexedDbTranscriptRepository';
import { ChromeSettingsStore } from '@/settings/ChromeSettingsStore';
import { DEFAULT_SETTINGS } from '@/settings/types';
import { JobStore } from '@/processing/job/JobStore';
import { MomRunner } from '@/processing/job/MomRunner';
import type { Message } from '@/messaging/messages';
import { applyIconTheme } from '@/background/icon';
import { notify } from '@/background/notify';
import { registerRoutes } from '@/background/routes';
import { SessionCoordinator } from '@/background/SessionCoordinator';
import { BackgroundState } from '@/background/state';
import { logger } from '@/utils/logger';

const log = logger('background');

/**
 * The composition root — the only place concrete adapters are constructed.
 *
 * Everything below is wiring. The behaviour lives in the modules this pulls
 * together: `SessionCoordinator` runs a meeting's life, `MomRunner` turns its
 * transcript into minutes, `routes` decides what each inbound event means.
 */
export function startBackground(): void {
  log.info('worker starting');
  const repo = new IndexedDbTranscriptRepository();
  const settings = new ChromeSettingsStore();
  const jobs = new JobStore();
  const state = new BackgroundState();

  function broadcast(msg: Message): void {
    // No receiver is the normal case — the popup is usually shut.
    void chrome.runtime.sendMessage(msg).catch(() => undefined);
  }

  const mom = new MomRunner({
    repo,
    settings,
    jobs,
    notify,
    onProgress: (sessionId, progress) => broadcast({ type: 'MOM_PROGRESS', sessionId, progress }),
  });

  const sessions = new SessionCoordinator({ repo, settings, state, mom });

  registerRoutes({ repo, settings, jobs, state, mom, sessions });

  // Registered synchronously (not inside the async block below) so it
  // survives a service-worker restart: MV3 replays only the listeners a
  // script attaches before its first await. Guarded on the theme actually
  // changing — every other setting fires this callback too, and setIcon on
  // every keystroke in the settings form would be wasteful.
  let currentIconTheme = DEFAULT_SETTINGS.iconTheme;
  settings.onChange((cfg) => {
    if (cfg.iconTheme === currentIconTheme) return;
    currentIconTheme = cfg.iconTheme;
    void applyIconTheme(cfg.iconTheme);
  });

  // The worker may be revived after a restart with work still in flight.
  void (async () => {
    const cfg = await settings.get();
    currentIconTheme = cfg.iconTheme;
    await applyIconTheme(cfg.iconTheme);
    await mom.recover();
    await sessions.armWatchdogIfBusy();
    log.info('worker ready');
  })();
}
