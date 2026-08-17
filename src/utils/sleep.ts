/** Awaitable delay. Injectable everywhere it is used, so tests never wait. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type Sleep = typeof sleep;
