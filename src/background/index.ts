import { IndexedDbTranscriptRepository } from '@/storage/IndexedDbTranscriptRepository';
import { ChromeSettingsStore } from '@/settings/ChromeSettingsStore';
import { JobStore } from '@/processing/job/JobStore';
import { MomRunner } from '@/processing/job/MomRunner';
import type { Message } from '@/messaging/messages';
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

  // The worker may be revived after a restart with work still in flight.
  void (async () => {
    await mom.recover();
    await sessions.armWatchdogIfBusy();
    log.info('worker ready');
  })();
}
