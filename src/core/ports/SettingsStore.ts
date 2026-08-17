import type { Unsubscribe } from '@/core/ports/MeetingBot';

export interface Settings {
  readonly botAccountIndex: number | null;
  readonly autoJoin: boolean;
  readonly toastDelayMs: number;

  /**
   * The AI summary toggle. Off by default: capture works without a model, and
   * nothing should be sent anywhere until the user has explicitly asked for it
   * and seen where it is going.
   */
  readonly momEnabled: boolean;
  readonly llmBaseUrl: string;
  readonly llmApiKey: string;
  readonly llmModel: string;
  readonly llmContextTokens: number;
}

/**
 * Prefilled for a local Ollama, which is the private-by-default option and
 * needs no account. Ollama ignores the key entirely — 'ollama' is the
 * community convention for a field that must be non-empty but is never read.
 */
export const DEFAULT_SETTINGS: Settings = {
  botAccountIndex: null,
  autoJoin: true,
  toastDelayMs: 5000,

  momEnabled: false,
  llmBaseUrl: 'http://localhost:11434/v1',
  llmApiKey: 'ollama',
  llmModel: 'qwen3:14b',
  llmContextTokens: 4096,
};

export interface SettingsStore {
  get(): Promise<Settings>;
  set(patch: Partial<Settings>): Promise<void>;
  onChange(cb: (s: Settings) => void): Unsubscribe;
}
