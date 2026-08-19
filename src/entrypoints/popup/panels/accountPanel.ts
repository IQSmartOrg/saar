import type { SettingsStore } from '@/settings/types';
import {
  describeAccount,
  listGoogleAccounts,
  type GoogleAccount,
} from '@/settings/googleAccounts';
import { byId } from '@/ui/dom';
import { logger } from '@/utils/logger';

const log = logger('settings.accountPanel');

/**
 * Choosing which Google account Saar joins meetings as.
 *
 * Discovery runs HERE, in the popup, not in the service worker. The popup is an
 * extension page with the same host permissions, so the probe works
 * identically — but it avoids a worker that may be asleep, a message round
 * trip, and a response that arrives after the worker has been killed.
 */

const CACHE_KEY = 'saar:accounts';
const CACHE_AT_KEY = 'saar:accountsAt';

/**
 * How long a cached account list is trusted.
 *
 * The scan probes every `authuser` index and each page is ~2.3MB, because the
 * account markup sits at the very end of it — so a scan costs around 20MB.
 * Doing that every time the popup opens is indefensible, and accounts are
 * signed in and out rarely. Refresh always rescans, so a stale list is one
 * click from being fixed.
 */
const CACHE_TTL_MS = 30 * 60_000;

async function cachedAccounts(): Promise<GoogleAccount[]> {
  const raw = await chrome.storage.local.get(CACHE_KEY);
  return (raw[CACHE_KEY] as GoogleAccount[] | undefined) ?? [];
}

async function cacheAgeMs(): Promise<number> {
  const raw = await chrome.storage.local.get(CACHE_AT_KEY);
  const at = raw[CACHE_AT_KEY] as number | undefined;
  return at === undefined ? Number.POSITIVE_INFINITY : Date.now() - at;
}

function describeReadiness(botAccountIndex: number | null): string {
  return botAccountIndex === null
    ? 'Choose the notetaker account to start.'
    : 'Ready — Saar will join your next Meet call.';
}

export function mountAccountPanel(settings: SettingsStore): void {
  const select = byId<HTMLSelectElement>('account');
  const refresh = byId<HTMLAnchorElement>('account-refresh');
  const status = byId('status');

  /**
   * Keeps a saved index that is no longer in the list rather than silently
   * dropping it: `authuser` numbering shifts when accounts sign in or out, and
   * quietly reassigning the notetaker would mean joining meetings as the wrong
   * person.
   */
  function render(accounts: readonly GoogleAccount[], saved: number | null): void {
    select.replaceChildren();

    if (accounts.length === 0) {
      select.append(new Option('No Google accounts found', ''));
      select.value = '';
      status.textContent = 'Sign the notetaker account into this Chrome profile, then Refresh.';
      return;
    }

    select.append(new Option('Choose an account…', ''));
    for (const account of accounts) {
      const label = describeAccount(account);
      const option = new Option(label, String(account.authuser));
      option.title = label; // the popup is 300px wide; the label often truncates
      select.append(option);
    }

    if (saved !== null && !accounts.some((a) => a.authuser === saved)) {
      select.append(new Option(`Account ${saved} (not signed in)`, String(saved)));
    }
    select.value = saved === null ? '' : String(saved);
    status.textContent = describeReadiness(saved);
  }

  /** Probes for accounts and caches the result so reopening is instant. */
  async function load(): Promise<void> {
    const saved = (await settings.get()).botAccountIndex;
    const startedAt = Date.now();
    log.info('refreshing the account list', { savedIndex: saved });
    try {
      const accounts = await listGoogleAccounts();
      log.info('account list refreshed', {
        count: accounts.length,
        ms: Date.now() - startedAt,
        accounts: accounts.map((a) => `${a.authuser}:${a.email}`),
        savedIndex: saved,
        savedStillPresent: saved === null || accounts.some((a) => a.authuser === saved),
      });
      await chrome.storage.local.set({ [CACHE_KEY]: accounts, [CACHE_AT_KEY]: Date.now() });
      render(accounts, saved);
      if (accounts.length === 0) {
        status.textContent = 'No Google accounts found — are you signed in to Google in Chrome?';
      }
    } catch (e) {
      log.severe('could not read the Google accounts', { error: e });
      // Never leave "No accounts found" standing in for an actual error.
      render(await cachedAccounts(), saved);
      const detail = e instanceof Error ? e.message : String(e);
      status.textContent = `Could not read your Google accounts: ${detail}`;
    }
  }

  select.addEventListener('change', () => {
    const next = select.value === '' ? null : Number(select.value);
    log.info('notetaker account chosen', { authuser: next });
    status.textContent = describeReadiness(next);
    void settings.set({ botAccountIndex: next });
  });

  refresh.addEventListener('click', (e) => {
    e.preventDefault();
    log.info('refresh clicked — rescanning regardless of the cache');
    select.replaceChildren(new Option('Loading accounts…', ''));
    void load();
  });

  void (async () => {
    const cfg = await settings.get();
    const cached = await cachedAccounts();
    // Show the cached list first — the probe takes a few seconds, and staring
    // at an empty dropdown reads as broken.
    if (cached.length > 0) {
      render(cached, cfg.botAccountIndex);
    } else {
      select.replaceChildren(new Option('Loading accounts…', ''));
      status.textContent = describeReadiness(cfg.botAccountIndex);
    }

    // A scan is ~20MB, so opening the popup does not trigger one unless the
    // cached list is missing or old. Refresh is the deliberate way to force it.
    const age = await cacheAgeMs();
    if (cached.length > 0 && age < CACHE_TTL_MS) {
      log.info('using the cached account list', {
        count: cached.length,
        ageMinutes: Math.round(age / 60_000),
      });
      return;
    }
    await load();
  })();
}
