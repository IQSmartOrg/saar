import { sleep as realSleep, type Sleep } from '@/utils/sleep';

/**
 * Waiting in a state until the world moves on, with a budget per state.
 *
 * Written for driving a page we do not control. The rule that makes it safe:
 * **the state is observed, never remembered.** `observe()` re-derives it from
 * the world on every tick, so a page that goes backwards — admitted, then
 * removed, then back on the pre-join screen — is followed rather than fought.
 * A machine that trusts its own bookkeeping instead sits in a state the world
 * left minutes ago, which is worse than no state machine at all.
 *
 * Budgets are per *occupancy*, and they reset when a state is genuinely
 * re-entered. That is what lets stages with different natural timescales share
 * one run: waiting for a control to render is machine-speed and should give up
 * in seconds, while waiting for a human to press a button deserves minutes. A
 * single overall budget cannot serve both, and lets a slow stage silently eat
 * the next one's time.
 *
 * `totalBudgetMs` is the backstop for the cost of resetting: a world that flaps
 * between two states would otherwise never run out.
 */

export interface StateContext<S extends string> {
  readonly state: S;
  /** How long the machine has been in this state, this time around. */
  readonly msInState: number;
  /** How long the whole run has taken. */
  readonly msTotal: number;
}

export interface StateSpec<S extends string> {
  /** How long this state may be occupied before the run fails. */
  readonly budgetMs: number;
  /** Called once when the state is entered, including on re-entry. */
  readonly onEnter?: (ctx: StateContext<S>) => void;
  /** Called once per tick while in this state. Side effects belong here. */
  readonly onTick?: (ctx: StateContext<S>) => Promise<void> | void;
  /** The failure message when the budget runs out. */
  readonly onTimeout: (ctx: StateContext<S>) => string;
}

export interface StateVisit<S extends string> {
  readonly state: S;
  /** Milliseconds into the run when the state was entered. */
  readonly at: number;
  /** How long it was occupied. */
  readonly ms: number;
}

export interface MachineOptions<S extends string> {
  /** Derives the current state from the world. Called every tick. */
  readonly observe: () => S;
  readonly states: Readonly<Record<S, StateSpec<S>>>;
  /** States that end the run successfully. */
  readonly done: readonly S[];
  readonly pollMs: number;
  /** Ceiling across the whole run, so a flapping world cannot loop forever. */
  readonly totalBudgetMs: number;
  readonly sleep?: Sleep;
  readonly now?: () => number;
}

export interface MachineResult<S extends string> {
  readonly ok: boolean;
  /** The state the run ended in. */
  readonly state: S;
  readonly error?: string;
  /** Every state occupied, in order, with how long each took. */
  readonly visited: readonly StateVisit<S>[];
}

export async function runStateMachine<S extends string>(
  opts: MachineOptions<S>,
): Promise<MachineResult<S>> {
  const {
    observe,
    states,
    done,
    pollMs,
    totalBudgetMs,
    sleep = realSleep,
    now = () => Date.now(),
  } = opts;

  const startedAt = now();
  const visited: StateVisit<S>[] = [];

  let current = observe();
  let enteredAt = now();

  const ctx = (): StateContext<S> => ({
    state: current,
    msInState: now() - enteredAt,
    msTotal: now() - startedAt,
  });

  const close = (): void => {
    visited.push({ state: current, at: enteredAt - startedAt, ms: now() - enteredAt });
  };

  states[current].onEnter?.(ctx());

  for (;;) {
    if (done.includes(current)) {
      close();
      return { ok: true, state: current, visited };
    }

    const spec = states[current];

    if (now() - enteredAt >= spec.budgetMs) {
      const error = spec.onTimeout(ctx());
      close();
      return { ok: false, state: current, error, visited };
    }

    if (now() - startedAt >= totalBudgetMs) {
      close();
      return {
        ok: false,
        state: current,
        error: `gave up after ${Math.round(totalBudgetMs / 1000)}s without getting anywhere`,
        visited,
      };
    }

    await spec.onTick?.(ctx());
    await sleep(pollMs);

    const next = observe();
    if (next !== current) {
      close();
      current = next;
      enteredAt = now();
      states[current].onEnter?.(ctx());
    }
  }
}
