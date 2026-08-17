import { SessionRegistry } from '@/session/SessionRegistry';
import { SessionStopWatch } from '@/session/stopSignals';

/**
 * Everything the background worker must remember across its own death.
 *
 * An MV3 service worker is terminated after ~30s idle, so nothing here may live
 * only in memory: an in-memory `lastHeartbeatAt` would be lost on every wake
 * and the watchdog would either never fire or fire immediately.
 *
 * `chrome.storage.session` rather than `local`: this is state about calls
 * happening right now, and it should not survive a browser restart — a session
 * whose tabs are gone has nothing left to watch.
 */

const REGISTRY_KEY = 'saar:sessions';
const WATCH_KEY = 'saar:stopwatch';

export class BackgroundState {
  async loadRegistry(): Promise<SessionRegistry> {
    const raw = await chrome.storage.session.get(REGISTRY_KEY);
    return SessionRegistry.fromJSON(raw[REGISTRY_KEY]);
  }

  async saveRegistry(registry: SessionRegistry): Promise<void> {
    await chrome.storage.session.set({ [REGISTRY_KEY]: registry.toJSON() });
  }

  async loadWatches(): Promise<Map<string, SessionStopWatch>> {
    const raw = await chrome.storage.session.get(WATCH_KEY);
    const rows = (raw[WATCH_KEY] as unknown[] | undefined) ?? [];
    const watches = rows.map((row) => SessionStopWatch.fromJSON(row));
    return new Map(watches.map((w) => [w.sessionId, w]));
  }

  async saveWatches(watches: Map<string, SessionStopWatch>): Promise<void> {
    await chrome.storage.session.set({
      [WATCH_KEY]: [...watches.values()].map((w) => w.toJSON()),
    });
  }
}
