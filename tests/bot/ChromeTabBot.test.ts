import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BOT_WINDOW, ChromeTabBot } from '@/bot/ChromeTabBot';

let createdWindows: Array<Record<string, unknown>>;
let createdTabs: Array<Record<string, unknown>>;
let updated: Array<[number, Record<string, unknown>]>;
let removedWindows: number[];
let removedTabs: number[];
let nextWindow: { id?: number; tabs?: Array<{ id?: number }> } | undefined;

beforeEach(() => {
  createdWindows = [];
  createdTabs = [];
  updated = [];
  removedWindows = [];
  removedTabs = [];
  nextWindow = { id: 7, tabs: [{ id: 42 }] };

  vi.stubGlobal('chrome', {
    windows: {
      create: async (opts: Record<string, unknown>) => {
        createdWindows.push(opts);
        return nextWindow;
      },
      remove: async (id: number) => {
        removedWindows.push(id);
      },
    },
    tabs: {
      create: async (opts: Record<string, unknown>) => {
        createdTabs.push(opts);
        return { id: 42 };
      },
      update: async (id: number, opts: Record<string, unknown>) => {
        updated.push([id, opts]);
        return { id };
      },
      remove: async (id: number) => {
        removedTabs.push(id);
      },
    },
  });
});

const req = { sessionId: 's1', meetingCode: 'abc-defg-hij', accountIndex: 1 };

describe('ChromeTabBot', () => {
  it('opens a window rather than a background tab, so the page actually renders', async () => {
    // A hidden tab does not run requestAnimationFrame, so Meet's DOM never
    // updates: no join, and no captions. Being a window's active tab is what
    // makes it visible.
    const res = await new ChromeTabBot().join(req);
    expect(res.ok).toBe(true);
    expect(createdWindows).toHaveLength(1);
    expect(createdTabs).toHaveLength(0);
  });

  it('does not steal focus', async () => {
    await new ChromeTabBot().join(req);
    expect(createdWindows[0]!.focused).toBe(false);
  });

  it('is large enough for Meet to render its desktop layout', async () => {
    // Every selector in meet/controls.ts is written against the desktop layout;
    // a small window gets a different one.
    await new ChromeTabBot().join(req);
    expect(createdWindows[0]!.width).toBe(BOT_WINDOW.width);
    expect(createdWindows[0]!.height).toBe(BOT_WINDOW.height);
    expect(BOT_WINDOW.width).toBeGreaterThanOrEqual(1024);
  });

  it('mutes the tab, so meeting audio cannot loop back through the mic', async () => {
    await new ChromeTabBot().join(req);
    expect(updated).toContainEqual([42, { muted: true }]);
  });

  it('carries the account index and session id through the URL', async () => {
    await new ChromeTabBot().join(req);
    expect(createdWindows[0]!.url).toBe(
      'https://meet.google.com/abc-defg-hij?authuser=1&saarSession=s1',
    );
  });

  it('reports the tab id, which the session registry needs for teardown', async () => {
    expect((await new ChromeTabBot().join(req)).tabId).toBe(42);
  });

  it('fails cleanly when the window comes back without a tab', async () => {
    nextWindow = { id: 7, tabs: [] };
    const res = await new ChromeTabBot().join(req);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/notetaker window/);
  });

  it('leave closes the window exactly once', async () => {
    const bot = new ChromeTabBot();
    await bot.join(req);
    await bot.leave();
    await bot.leave();
    expect(removedWindows).toEqual([7]);
  });

  it('leave before join is a no-op rather than an error', async () => {
    await expect(new ChromeTabBot().leave()).resolves.toBeUndefined();
    expect(removedWindows).toEqual([]);
    expect(removedTabs).toEqual([]);
  });
});
