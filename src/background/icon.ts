import type { Settings } from '@/settings/types';
import { logger } from '@/utils/logger';

const log = logger('background.icon');

const ICON_SIZES = [16, 32, 48, 128] as const;

/**
 * Which asset set backs which setting.
 *
 * `assets/icon-*.png` is the navy mark, legible on a light toolbar.
 * `assets/icon-light-*.png` is the white mark, legible on a dark one — the
 * name is inherited from Chrome's `theme_icons` key it was originally built
 * for, which turned out to be a no-op in Chrome (see the `iconTheme` doc
 * comment on `Settings`). Kept as-is here to avoid an asset rename; only this
 * mapping needs to know the file names are the opposite way round from the
 * setting value.
 */
export function iconPaths(theme: Settings['iconTheme']): Record<string, string> {
  const prefix = theme === 'dark' ? 'icon-light' : 'icon';
  return Object.fromEntries(ICON_SIZES.map((size) => [String(size), `/${prefix}-${size}.png`]));
}

/** Sets the toolbar icon to match the user's chosen theme. */
export async function applyIconTheme(theme: Settings['iconTheme']): Promise<void> {
  log.debug('setting the toolbar icon', { theme });
  await chrome.action.setIcon({ path: iconPaths(theme) });
}
