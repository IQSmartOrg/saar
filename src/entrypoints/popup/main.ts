import { ChromeSettingsStore } from '@/adapters/storage/ChromeSettingsStore';

const settings = new ChromeSettingsStore();
const account = document.getElementById('account') as HTMLInputElement;
const status = document.getElementById('status') as HTMLElement;
const open = document.getElementById('open') as HTMLButtonElement;

function describe(botAccountIndex: number | null): string {
  return botAccountIndex === null
    ? 'Set the notetaker account index to start.'
    : 'Ready — Saar will join your next Meet call.';
}

void (async () => {
  const cfg = await settings.get();
  account.value = cfg.botAccountIndex === null ? '' : String(cfg.botAccountIndex);
  status.textContent = describe(cfg.botAccountIndex);
})();

account.addEventListener('change', () => {
  const raw = account.value.trim();
  const parsed = raw === '' ? null : Number(raw);
  const next = parsed !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  status.textContent = describe(next);
  void settings.set({ botAccountIndex: next });
});

open.addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('/meetings.html') });
});
