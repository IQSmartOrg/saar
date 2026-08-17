import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChromeTabBot } from '@/bot/ChromeTabBot';

let created: Array<Record<string, unknown>>;
let updated: Array<[number, Record<string, unknown>]>;
let removed: number[];
let nextTabId: number | undefined;

beforeEach(() => {
  created = [];
  updated = [];
  removed = [];
  nextTabId = 42;
  vi.stubGlobal('chrome', {
    tabs: {
      create: async (opts: Record<string, unknown>) => {
        created.push(opts);
        return { id: nextTabId };
      },
      update: async (id: number, opts: Record<string, unknown>) => {
        updated.push([id, opts]);
        return { id };
      },
      remove: async (id: number) => {
        removed.push(id);
      },
    },
  });
});

const req = { sessionId: 's1', meetingCode: 'abc-defg-hij', accountIndex: 1 };

describe('ChromeTabBot', () => {
  it('creates the tab inactive and mutes it before returning', async () => {
    const res = await new ChromeTabBot().join(req);
    expect(res.ok).toBe(true);
    expect(res.tabId).toBe(42);
    expect(created[0]!.active).toBe(false);
    expect(updated).toContainEqual([42, { muted: true }]);
  });

  it('passes the account index and session id through the URL', async () => {
    await new ChromeTabBot().join(req);
    expect(created[0]!.url).toBe(
      'https://meet.google.com/abc-defg-hij?authuser=1&saarSession=s1',
    );
  });

  it('reports failure when the created tab has no id', async () => {
    nextTabId = undefined;
    const res = await new ChromeTabBot().join(req);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no id/);
  });

  it('leave closes the tab exactly once', async () => {
    const bot = new ChromeTabBot();
    await bot.join(req);
    await bot.leave();
    await bot.leave();
    expect(removed).toEqual([42]);
  });

  it('leave before join is a no-op rather than an error', async () => {
    await expect(new ChromeTabBot().leave()).resolves.toBeUndefined();
    expect(removed).toEqual([]);
  });
});
