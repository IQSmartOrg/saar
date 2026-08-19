import { ChromeSettingsStore } from '@/settings/ChromeSettingsStore';
import { addSink } from '@/utils/logger';
import type { Message } from '@/messaging/messages';
import { byId } from '@/ui/dom';
import { mountNowPanel } from '@/entrypoints/popup/panels/nowPanel';
import { mountAccountPanel } from '@/entrypoints/popup/panels/accountPanel';
import { mountAiPanel } from '@/entrypoints/popup/panels/aiPanel';
import { mountAppearancePanel } from '@/entrypoints/popup/panels/appearancePanel';

/**
 * The popup, which is two tabs over three panels: what Saar is doing right now,
 * and the two things it needs to be told. Each panel owns its own markup,
 * storage reads and event wiring; this file only decides which is visible.
 */

const TABS = ['now', 'setup'] as const;
type Tab = (typeof TABS)[number];

const tabs: Record<Tab, HTMLButtonElement> = {
  now: byId('tab-now'),
  setup: byId('tab-setup'),
};
const panes: Record<Tab, HTMLElement> = {
  now: byId('pane-now'),
  setup: byId('pane-setup'),
};

function showTab(which: Tab): void {
  for (const tab of TABS) {
    tabs[tab].setAttribute('aria-selected', String(tab === which));
    panes[tab].hidden = tab !== which;
  }
}

for (const tab of TABS) tabs[tab].addEventListener('click', () => showTab(tab));

// The popup's own console closes with the popup — which is exactly when you
// want to read what it just did. Forward to the worker, whose console stays.
addSink((record) => {
  void chrome.runtime.sendMessage({ type: 'LOG', record } satisfies Message).catch(() => undefined);
});

const settings = new ChromeSettingsStore();
mountNowPanel();
mountAccountPanel(settings);
mountAiPanel(settings);
mountAppearancePanel(settings);
