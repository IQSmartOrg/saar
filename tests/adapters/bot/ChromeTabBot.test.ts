import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChromeTabBot, buildMeetUrl } from '@/adapters/bot/ChromeTabBot';

let created: Array<Record<string, unknown>>;
let updated: Array<[number, Record<string, unknown>]>;
let removed: number[];
let removeListeners: Array<(tabId: number) => void>;
let nextTabId: number | undefined;

beforeEach(() => {
  created = [];
  updated = [];
  removed = [];
  removeListeners = [];
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
      onRemoved: {
        addListener: (fn: (t: number) => void) => removeListeners.push(fn),
        removeListener: (fn: (t: number) => void) => {
          removeListeners = removeListeners.filter((l) => l !== fn);
        },
      },
    },
  });
});

const req = { sessionId: 's1', meetingCode: 'abc-defg-hij', accountIndex: 1 };

describe('buildMeetUrl', () => {
  it('appends the authuser index', () => {
    expect(buildMeetUrl('abc-defg-hij', 1)).toBe('https://meet.google.com/abc-defg-hij?authuser=1');
  });
});

describe('ChromeTabBot', () => {
  it('creates the tab inactive and mutes it before returning', async () => {
    const res = await new ChromeTabBot().join(req);
    expect(res.ok).toBe(true);
    expect(res.tabId).toBe(42);
    expect(created[0]!.active).toBe(false);
    expect(updated).toContainEqual([42, { muted: true }]);
  });

  it('passes the session id to the bot tab via saarSession', async () => {
    await new ChromeTabBot().join(req);
    expect(created[0]!.url).toBe('https://meet.google.com/abc-defg-hij?authuser=1&saarSession=s1');
  });

  it('reports failure when the created tab has no id', async () => {
    nextTabId = undefined;
    const res = await new ChromeTabBot().join(req);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no id/);
  });

  it('reports tab-closed when the bot tab disappears', async () => {
    const bot = new ChromeTabBot();
    await bot.join(req);
    const reasons: string[] = [];
    bot.onEnded((r) => reasons.push(r));
    removeListeners.forEach((l) => l(42));
    expect(reasons).toEqual(['tab-closed']);
  });

  it('ignores removal of unrelated tabs', async () => {
    const bot = new ChromeTabBot();
    await bot.join(req);
    const reasons: string[] = [];
    bot.onEnded((r) => reasons.push(r));
    removeListeners.forEach((l) => l(999));
    expect(reasons).toEqual([]);
  });

  it('leave closes the tab exactly once', async () => {
    const bot = new ChromeTabBot();
    await bot.join(req);
    await bot.leave();
    await bot.leave();
    expect(removed).toEqual([42]);
  });

  it('unsubscribing stops end notifications', async () => {
    const bot = new ChromeTabBot();
    await bot.join(req);
    const reasons: string[] = [];
    const off = bot.onEnded((r) => reasons.push(r));
    off();
    removeListeners.forEach((l) => l(42));
    expect(reasons).toEqual([]);
  });
});
