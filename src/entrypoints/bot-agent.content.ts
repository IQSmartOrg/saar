import { startNotetakerAgent } from '@/agents/notetakerAgent';

/** WXT entrypoint. Everything it does lives in `src/agents/notetakerAgent.ts`. */
export default defineContentScript({
  matches: ['https://meet.google.com/*'],
  main: startNotetakerAgent,
});
