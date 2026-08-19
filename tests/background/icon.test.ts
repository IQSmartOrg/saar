import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyIconTheme, iconPaths } from '@/background/icon';

/**
 * Chrome has no built-in theme-aware icon support (see the `iconTheme` doc
 * comment on `Settings`), so this is the one place that decides which asset
 * set a setting value maps to.
 */

let setIconCalls: unknown[];

beforeEach(() => {
  setIconCalls = [];
  vi.stubGlobal('chrome', {
    action: {
      setIcon: async (opts: unknown) => {
        setIconCalls.push(opts);
      },
    },
  });
});

describe('iconPaths', () => {
  it('maps "dark" to the white mark, legible on a dark toolbar', () => {
    expect(iconPaths('dark')).toEqual({
      '16': '/icon-light-16.png',
      '32': '/icon-light-32.png',
      '48': '/icon-light-48.png',
      '128': '/icon-light-128.png',
    });
  });

  it('maps "light" to the navy mark, legible on a light toolbar', () => {
    expect(iconPaths('light')).toEqual({
      '16': '/icon-16.png',
      '32': '/icon-32.png',
      '48': '/icon-48.png',
      '128': '/icon-128.png',
    });
  });
});

describe('applyIconTheme', () => {
  it('calls chrome.action.setIcon with the matching path set', async () => {
    await applyIconTheme('dark');
    expect(setIconCalls).toEqual([{ path: iconPaths('dark') }]);
  });
});
