import { DEFAULT_SETTINGS, type Settings, type SettingsStore } from '@/core/ports/SettingsStore';
import type { Unsubscribe } from '@/core/ports/MeetingBot';

export const SETTINGS_KEY = 'saar:settings';

/**
 * Backed by `chrome.storage.local`, never `sync` — settings will eventually
 * hold an API key, and secrets must not replicate across devices.
 */
export class ChromeSettingsStore implements SettingsStore {
  async get(): Promise<Settings> {
    const raw = await chrome.storage.local.get(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(raw[SETTINGS_KEY] as Partial<Settings> | undefined) };
  }

  async set(patch: Partial<Settings>): Promise<void> {
    const next = { ...(await this.get()), ...patch };
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  }

  onChange(cb: (s: Settings) => void): Unsubscribe {
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ): void => {
      if (area !== 'local') return;
      const change = changes[SETTINGS_KEY];
      if (!change) return;
      cb({ ...DEFAULT_SETTINGS, ...(change.newValue as Partial<Settings> | undefined) });
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }
}
