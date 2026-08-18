import { keepRendering } from '@/agents/keepRendering';
import { isBotTab } from '@/meet/meetingCode';

/**
 * WXT entrypoint. Everything it does lives in `src/agents/keepRendering.ts`.
 *
 * MAIN world, because it replaces globals Meet's own code reads — an isolated
 * world has its own copy of them and Meet would never see the change.
 *
 * document_start, because Meet captures `requestAnimationFrame` early and a
 * replacement that lands afterwards is ignored.
 *
 * Only the notetaker's tab. Spoofing visibility in the user's own Meet tab
 * would keep it rendering in the background for no benefit — burning battery
 * and changing how Meet behaves for them.
 */
export default defineContentScript({
  matches: ['https://meet.google.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    if (!isBotTab(location.href)) return;
    keepRendering(window);
  },
});
