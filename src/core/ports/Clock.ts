export interface Clock {
  now(): number;
}

export const SystemClock: Clock = { now: () => Date.now() };
