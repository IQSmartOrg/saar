import { startUserTabAgent } from '@/agents/userTabAgent';

/** WXT entrypoint. Everything it does lives in `src/agents/userTabAgent.ts`. */
export default defineContentScript({
  matches: ['https://meet.google.com/*'],
  main: startUserTabAgent,
});
