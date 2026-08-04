export interface Scheduler {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

export const SystemScheduler: Scheduler = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
  clearTimeout: (h) => globalThis.clearTimeout(h),
};
