import type { SettingsStore } from '@/settings/types';
import {
  describeAccount,
  listGoogleAccounts,
  type GoogleAccount,
} from '@/settings/googleAccounts';
import { byId } from '@/ui/dom';

/**
 * Choosing which Google account Saar joins meetings as.
 *
 * Discovery runs HERE, in the popup, not in the service worker. The popup is an
 * extension page with the same host permissions, so the probe works
 * identically — but it avoids a worker that may be asleep, a message round
 * trip, and a response that arrives after the worker has been killed.
 */

const CACHE_KEY = 'saar:accounts';

async function cachedAccounts(): Promise<GoogleAccount[]> {
  const raw = await chrome.storage.local.get(CACHE_KEY);
  return (raw[CACHE_KEY] as GoogleAccount[] | undefined) ?? [];
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
    try {
      const accounts = await listGoogleAccounts();
      await chrome.storage.local.set({ [CACHE_KEY]: accounts });
      render(accounts, saved);
      if (accounts.length === 0) {
        status.textContent = 'No Google accounts found — are you signed in to Google in Chrome?';
      }
    } catch (e) {
      // Never leave "No accounts found" standing in for an actual error.
      render(await cachedAccounts(), saved);
      const detail = e instanceof Error ? e.message : String(e);
      status.textContent = `Could not read your Google accounts: ${detail}`;
    }
  }

  select.addEventListener('change', () => {
    const next = select.value === '' ? null : Number(select.value);
    status.textContent = describeReadiness(next);
    void settings.set({ botAccountIndex: next });
  });

  refresh.addEventListener('click', (e) => {
    e.preventDefault();
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
    await load();
  })();
}
