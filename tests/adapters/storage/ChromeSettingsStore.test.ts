import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChromeSettingsStore, SETTINGS_KEY } from '@/adapters/storage/ChromeSettingsStore';
import { DEFAULT_SETTINGS } from '@/core/ports/SettingsStore';

type Listener = (c: Record<string, { newValue?: unknown }>, area: string) => void;

let store: Record<string, unknown>;
let listeners: Listener[];

beforeEach(() => {
  store = {};
  listeners = [];
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        },
      },
      onChanged: {
        addListener: (fn: Listener) => listeners.push(fn),
        removeListener: (fn: Listener) => {
          listeners = listeners.filter((l) => l !== fn);
        },
      },
    },
  });
});

function emit(newValue: unknown, area = 'local'): void {
  listeners.forEach((l) => l({ [SETTINGS_KEY]: { newValue } }, area));
}

describe('ChromeSettingsStore', () => {
  it('returns defaults when nothing is stored', async () => {
    expect(await new ChromeSettingsStore().get()).toEqual(DEFAULT_SETTINGS);
  });

  it('merges a patch over the defaults', async () => {
    const s = new ChromeSettingsStore();
    await s.set({ botAccountIndex: 1 });
    const got = await s.get();
    expect(got.botAccountIndex).toBe(1);
    expect(got.autoJoin).toBe(DEFAULT_SETTINGS.autoJoin);
  });

  it('a second patch does not clobber the first', async () => {
    const s = new ChromeSettingsStore();
    await s.set({ botAccountIndex: 2 });
    await s.set({ toastDelayMs: 1000 });
    const got = await s.get();
    expect(got.botAccountIndex).toBe(2);
    expect(got.toastDelayMs).toBe(1000);
  });

  it('notifies subscribers on change', async () => {
    const s = new ChromeSettingsStore();
    const seen: number[] = [];
    s.onChange((next) => seen.push(next.toastDelayMs));
    emit({ ...DEFAULT_SETTINGS, toastDelayMs: 99 });
    expect(seen).toEqual([99]);
  });

  it('ignores changes from other storage areas', async () => {
    const s = new ChromeSettingsStore();
    const seen: number[] = [];
    s.onChange((next) => seen.push(next.toastDelayMs));
    emit({ ...DEFAULT_SETTINGS, toastDelayMs: 99 }, 'sync');
    expect(seen).toEqual([]);
  });

  it('unsubscribe stops further notifications', async () => {
    const s = new ChromeSettingsStore();
    const seen: number[] = [];
    const off = s.onChange((next) => seen.push(next.toastDelayMs));
    off();
    emit({ ...DEFAULT_SETTINGS, toastDelayMs: 99 });
    expect(seen).toEqual([]);
  });
});
