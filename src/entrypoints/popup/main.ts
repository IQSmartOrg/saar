import { ChromeSettingsStore } from '@/adapters/storage/ChromeSettingsStore';
import type { ActiveSessionSummary, Message } from '@/shared/messaging/messages';

const settings = new ChromeSettingsStore();
const account = document.getElementById('account') as HTMLInputElement;
const status = document.getElementById('status') as HTMLElement;
const open = document.getElementById('open') as HTMLButtonElement;
const active = document.getElementById('active') as HTMLElement;
const activeTitle = document.getElementById('active-title') as HTMLElement;
const activeElapsed = document.getElementById('active-elapsed') as HTMLElement;
const stop = document.getElementById('stop') as HTMLButtonElement;

function elapsed(since: number): string {
  const secs = Math.max(0, Math.round((Date.now() - since) / 1000));
  const m = Math.floor(secs / 60);
  return m < 1 ? `${secs}s` : `${m}m ${secs % 60}s`;
}

/** Signal 8. The popup is the only place a user can stop a recording by hand. */
async function refreshActive(): Promise<void> {
  const send = (m: Message): Promise<ActiveSessionSummary[]> =>
    chrome.runtime.sendMessage(m) as Promise<ActiveSessionSummary[]>;

  const rows = (await send({ type: 'ACTIVE_SESSIONS_QUERY' })) ?? [];
  const current = rows[0];

  active.hidden = current === undefined;
  if (current === undefined) return;

  activeTitle.textContent = current.title ?? current.meetingCode;
  activeElapsed.textContent =
    current.startedAt > 0 ? `Recording for ${elapsed(current.startedAt)}` : 'Recording';

  stop.onclick = () => {
    stop.disabled = true;
    stop.textContent = 'Stopping…';
    void chrome.runtime
      .sendMessage({ type: 'STOP_REQUESTED', sessionId: current.sessionId } satisfies Message)
      .then(() => window.close());
  };
}

void refreshActive();
setInterval(() => void refreshActive(), 1000);

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
