import { describe, it, expect } from 'vitest';
import { runStateMachine, type StateSpec } from '@/utils/stateMachine';

/**
 * The engine behind joining a meeting.
 *
 * Two properties carry it, and both fail silently when broken: the state is
 * re-observed every tick rather than remembered, and each state's budget is per
 * occupancy so stages with different natural timescales can share a run.
 */

type S = 'a' | 'b' | 'done';

/** Deterministic clock: every sleep advances virtual time, nothing is real. */
function fakeTime() {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      return Promise.resolve();
    },
  };
}

function spec(budgetMs: number, extra: Partial<StateSpec<S>> = {}): StateSpec<S> {
  return { budgetMs, onTimeout: (c) => `${c.state} expired after ${c.msInState}ms`, ...extra };
}

describe('reaching a done state', () => {
  it('succeeds as soon as the world reports one', async () => {
    let observed: S = 'a';
    const out = await runStateMachine<S>({
      ...fakeTime(),
      observe: () => observed,
      states: { a: spec(10_000, { onTick: () => { observed = 'done'; } }), b: spec(10_000), done: spec(Infinity) },
      done: ['done'],
      pollMs: 1000,
      totalBudgetMs: 60_000,
    });
    expect(out.ok).toBe(true);
    expect(out.state).toBe('done');
  });

  it('succeeds immediately when it starts in a done state', async () => {
    const out = await runStateMachine<S>({
      ...fakeTime(),
      observe: () => 'done',
      states: { a: spec(1), b: spec(1), done: spec(Infinity) },
      done: ['done'],
      pollMs: 1000,
      totalBudgetMs: 60_000,
    });
    expect(out.ok).toBe(true);
    expect(out.visited.map((v) => v.state)).toEqual(['done']);
  });
});

describe('budgets are per state, not shared', () => {
  it('a slow early state does not eat a later one', async () => {
    // The whole point of the redesign. `a` burns 8s of its 10s budget; `b` must
    // still get its own full 30s rather than the remainder of a shared pot.
    const clock = fakeTime();
    let observed: S = 'a';
    const out = await runStateMachine<S>({
      ...clock,
      observe: () => observed,
      states: {
        a: spec(10_000, { onTick: (c) => { if (c.msInState >= 8000) observed = 'b'; } }),
        b: spec(30_000),
        done: spec(Infinity),
      },
      done: ['done'],
      pollMs: 1000,
      totalBudgetMs: 300_000,
    });

    expect(out.ok).toBe(false);
    expect(out.state).toBe('b');
    // Failed on b's own 30s budget, at ~38s overall — not at a shared 10s.
    expect(out.error).toMatch(/^b expired/);
    expect(clock.now()).toBeGreaterThan(30_000);
  });

  it('reports which state ran out, and how long each took', async () => {
    let observed: S = 'a';
    const out = await runStateMachine<S>({
      ...fakeTime(),
      observe: () => observed,
      states: {
        a: spec(5000, { onTick: (c) => { if (c.msInState >= 3000) observed = 'b'; } }),
        b: spec(4000),
        done: spec(Infinity),
      },
      done: ['done'],
      pollMs: 1000,
      totalBudgetMs: 300_000,
    });

    expect(out.state).toBe('b');
    expect(out.visited.map((v) => v.state)).toEqual(['a', 'b']);
    expect(out.visited[0]!.ms).toBe(4000); // entered at 0, left after the tick that flipped it
  });
});

describe('the state is observed, never remembered', () => {
  it('follows the world backwards and gives the state a fresh budget', async () => {
    // A page that goes forwards then back — admitted, removed, pre-join again.
    // A machine that trusted its own bookkeeping would sit in `b` forever.
    const clock = fakeTime();
    const seen: S[] = [];
    let observed: S = 'a';
    await runStateMachine<S>({
      ...clock,
      observe: () => observed,
      states: {
        a: spec(6000, {
          onEnter: () => seen.push('a'),
          onTick: (c) => { if (c.msInState >= 2000) observed = 'b'; },
        }),
        b: spec(6000, {
          onEnter: () => seen.push('b'),
          onTick: (c) => { if (c.msInState >= 2000) observed = 'a'; },
        }),
        done: spec(Infinity),
      },
      done: ['done'],
      pollMs: 1000,
      totalBudgetMs: 20_000,
    });

    // It kept following rather than expiring: neither state's 6s budget ever
    // ran out, because re-entry resets it.
    expect(seen.length).toBeGreaterThan(3);
    expect(new Set(seen)).toEqual(new Set(['a', 'b']));
  });

  it('the total budget stops a world that flaps forever', async () => {
    const clock = fakeTime();
    let observed: S = 'a';
    const out = await runStateMachine<S>({
      ...clock,
      observe: () => { observed = observed === 'a' ? 'b' : 'a'; return observed; },
      states: { a: spec(60_000), b: spec(60_000), done: spec(Infinity) },
      done: ['done'],
      pollMs: 1000,
      totalBudgetMs: 15_000,
    });

    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/gave up after 15s/);
    expect(clock.now()).toBeLessThan(20_000);
  });
});

describe('callbacks', () => {
  it('onEnter fires on entry and on every genuine re-entry, not per tick', async () => {
    let observed: S = 'a';
    const enters: S[] = [];
    await runStateMachine<S>({
      ...fakeTime(),
      observe: () => observed,
      states: {
        a: spec(9000, {
          onEnter: (c) => enters.push(c.state),
          onTick: (c) => { if (c.msInState >= 3000) observed = 'b'; },
        }),
        b: spec(3000, { onEnter: (c) => enters.push(c.state) }),
        done: spec(Infinity),
      },
      done: ['done'],
      pollMs: 1000,
      totalBudgetMs: 60_000,
    });
    // Four ticks in `a`, one entry.
    expect(enters).toEqual(['a', 'b']);
  });
});
