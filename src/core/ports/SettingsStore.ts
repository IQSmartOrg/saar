import type { Unsubscribe } from '@/core/ports/MeetingBot';

export interface Settings {
  readonly botAccountIndex: number | null;
  readonly autoJoin: boolean;
  readonly toastDelayMs: number;
}

export const DEFAULT_SETTINGS: Settings = {
  botAccountIndex: null,
  autoJoin: true,
  toastDelayMs: 5000,
};

export interface SettingsStore {
  get(): Promise<Settings>;
  set(patch: Partial<Settings>): Promise<void>;
  onChange(cb: (s: Settings) => void): Unsubscribe;
}
