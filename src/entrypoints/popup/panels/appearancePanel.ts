import type { Settings, SettingsStore } from '@/settings/types';
import { byId } from '@/ui/dom';
import { logger } from '@/utils/logger';

const log = logger('settings.appearancePanel');

/**
 * The toolbar icon.
 *
 * Chrome has no way for the extension to sense the browser's own light/dark
 * theme from a service worker — no DOM, no `matchMedia`, and the manifest's
 * `theme_icons` field only Firefox and Safari honour. So this is a manual
 * choice rather than something detected; `background/icon.ts` applies it.
 */
export function mountAppearancePanel(settings: SettingsStore): void {
  const select = byId<HTMLSelectElement>('icon-theme');

  select.addEventListener('change', () => {
    const next = select.value as Settings['iconTheme'];
    log.info('toolbar icon chosen', { iconTheme: next });
    void settings.set({ iconTheme: next });
  });

  void (async () => {
    select.value = (await settings.get()).iconTheme;
  })();
}
