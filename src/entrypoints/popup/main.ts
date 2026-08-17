import { ChromeSettingsStore } from '@/adapters/storage/ChromeSettingsStore';
import type { Activity, LlmProbeResult, Message } from '@/shared/messaging/messages';
import { renderActivity } from '@/entrypoints/popup/activity';
import { listGoogleAccounts, type GoogleAccount } from '@/adapters/meet/accounts';

const settings = new ChromeSettingsStore();
const send = (m: Message): Promise<unknown> => chrome.runtime.sendMessage(m);

/* ------------------------------------------------------------------ *
 * Tabs
 * ------------------------------------------------------------------ */

const tabs = {
  now: document.getElementById('tab-now') as HTMLButtonElement,
  setup: document.getElementById('tab-setup') as HTMLButtonElement,
};
const panes = {
  now: document.getElementById('pane-now') as HTMLElement,
  setup: document.getElementById('pane-setup') as HTMLElement,
};

function showTab(which: 'now' | 'setup'): void {
  for (const key of ['now', 'setup'] as const) {
    tabs[key].setAttribute('aria-selected', String(key === which));
    panes[key].hidden = key !== which;
  }
}
tabs.now.addEventListener('click', () => showTab('now'));
tabs.setup.addEventListener('click', () => showTab('setup'));

/* ------------------------------------------------------------------ *
 * Now
 * ------------------------------------------------------------------ */

const activityRoot = document.getElementById('activity') as HTMLElement;

function openMeetings(sessionId?: string): void {
  const base = chrome.runtime.getURL('/meetings.html');
  void chrome.tabs.create({ url: sessionId === undefined ? base : `${base}#${sessionId}` });
}

async function refreshActivity(): Promise<void> {
  const activities = ((await send({ type: 'ACTIVITY_QUERY' })) ?? []) as Activity[];
  renderActivity(activityRoot, activities, {
    onStop: (sessionId) => {
      void send({ type: 'STOP_REQUESTED', sessionId }).then(() => refreshActivity());
    },
    onRetry: (sessionId) => {
      void send({ type: 'RETRY_REQUESTED', sessionId }).then(() => refreshActivity());
    },
    onOpen: (sessionId) => openMeetings(sessionId),
  });
}

void refreshActivity();
// A recording timer ticks every second; the push below covers everything else.
setInterval(() => void refreshActivity(), 1000);
chrome.runtime.onMessage.addListener((msg: Message) => {
  if (msg.type === 'MOM_PROGRESS') void refreshActivity();
});
const account = document.getElementById('account') as HTMLSelectElement;
const accountRefresh = document.getElementById('account-refresh') as HTMLAnchorElement;
const status = document.getElementById('status') as HTMLElement;
const open = document.getElementById('open') as HTMLButtonElement;

/* ------------------------------------------------------------------ *
 * AI summary
 * ------------------------------------------------------------------ */

const momEnabled = document.getElementById('mom-enabled') as HTMLInputElement;
const momConfig = document.getElementById('mom-config') as HTMLElement;
const llmUrl = document.getElementById('llm-url') as HTMLInputElement;
const llmKey = document.getElementById('llm-key') as HTMLInputElement;
const llmModel = document.getElementById('llm-model') as HTMLSelectElement;
const llmTest = document.getElementById('llm-test') as HTMLButtonElement;
const llmResult = document.getElementById('llm-result') as HTMLElement;


/** The endpoint fields only appear once the user asks for AI at all. */
function syncMomVisibility(): void {
  momConfig.hidden = !momEnabled.checked;
}

void (async () => {
  const cfg = await settings.get();
  momEnabled.checked = cfg.momEnabled;
  llmUrl.value = cfg.llmBaseUrl;
  llmKey.value = cfg.llmApiKey;
  renderModels(cfg.llmModel === '' ? [] : [cfg.llmModel], cfg.llmModel);
  syncMomVisibility();
  // Already configured: refresh the list quietly so the dropdown is live
  // without the user having to press Test.
  if (cfg.momEnabled) void testConnection();
})();

momEnabled.addEventListener('change', () => {
  syncMomVisibility();
  void settings.set({ momEnabled: momEnabled.checked });
  // Nothing is sent anywhere until this is on, so confirm the endpoint the
  // moment it is — better to find a broken URL now than after a meeting.
  if (momEnabled.checked) void testConnection();
});

// URL or key changed: the old model list belongs to a different endpoint, so
// clear it rather than letting a stale option look valid.
for (const [el, key] of [
  [llmUrl, 'llmBaseUrl'],
  [llmKey, 'llmApiKey'],
] as const) {
  el.addEventListener('change', () => {
    void settings.set({ [key]: el.value.trim() });
    llmResult.textContent = 'Endpoint changed — test the connection to load its models.';
  });
}

llmModel.addEventListener('change', () => {
  void settings.set({ llmModel: llmModel.value });
});

/** `http://localhost:11434/v1` → `http://localhost/*`, the permission pattern. */
function originPattern(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

/**
 * Asks for host permission on the configured endpoint.
 *
 * This is what makes a local Ollama work with no setup at all: Chrome omits
 * the Origin header on requests to a permitted host, so Ollama's
 * extension-origin block never applies. Without it Chrome sends
 * `Origin: chrome-extension://<id>` and Ollama answers 403.
 *
 * Must be called from a user gesture, which is why it hangs off the toggle and
 * the test button rather than running on load.
 */
async function ensureHostPermission(): Promise<boolean> {
  const pattern = originPattern(llmUrl.value.trim());
  if (pattern === null) return false;
  if (await chrome.permissions.contains({ origins: [pattern] })) return true;
  try {
    return await chrome.permissions.request({ origins: [pattern] });
  } catch {
    return false;
  }
}

/**
 * Fills the model dropdown from whatever the endpoint reports.
 *
 * Keeps the saved model selected even when it is missing from the list — a
 * transient outage must not silently switch which model summarises meetings.
 */
function renderModels(models: readonly string[], saved: string): void {
  llmModel.replaceChildren();

  if (models.length === 0) {
    llmModel.append(new Option('Connect to load models…', ''));
    llmModel.value = '';
    return;
  }

  for (const id of models) llmModel.append(new Option(id, id));

  if (saved !== '' && !models.includes(saved)) {
    llmModel.append(new Option(`${saved} (not installed)`, saved));
  }
  llmModel.value = saved !== '' ? saved : (models[0] ?? '');

  // Nothing was chosen before, so adopt whatever the dropdown landed on.
  if (saved !== llmModel.value) void settings.set({ llmModel: llmModel.value });
}

async function testConnection(): Promise<void> {
  llmTest.disabled = true;
  llmResult.textContent = 'Testing…';
  try {
    if (!(await ensureHostPermission())) {
      llmResult.textContent = '✗ Saar needs permission to reach that address.';
      return;
    }

    const probe = (await chrome.runtime.sendMessage({
      type: 'LLM_PROBE',
    } satisfies Message)) as LlmProbeResult | undefined;

    if (!probe?.ok) {
      if (probe?.originBlocked === true) {
        showOriginFix();
        return;
      }
      llmResult.textContent = `✗ ${probe?.detail ?? 'could not reach the model'}`;
      return;
    }

    const saved = (await settings.get()).llmModel;
    renderModels(probe.models, saved);
    llmResult.textContent =
      probe.models.length === 0
        ? '✓ Connected, but no models are installed'
        : `✓ Connected · ${probe.models.length} model${probe.models.length === 1 ? '' : 's'}`;
  } finally {
    llmTest.disabled = false;
  }
}

/**
 * The one-command fix for a local model refusing this extension.
 *
 * Rendered with a copyable command rather than described in prose: the string
 * contains this extension's own id, which nobody can be expected to type.
 */
function showOriginFix(): void {
  llmResult.replaceChildren();
  llmResult.append(
    document.createTextNode('✗ Ollama is refusing this extension. Run this, then restart Ollama:'),
  );

  const cmd = `launchctl setenv OLLAMA_ORIGINS "chrome-extension://${chrome.runtime.id}"`;
  const code = document.createElement('code');
  code.className = 'cmd';
  code.textContent = cmd;
  llmResult.append(code);

  const copyCmd = document.createElement('button');
  copyCmd.type = 'button';
  copyCmd.className = 'secondary';
  copyCmd.textContent = 'Copy command';
  copyCmd.addEventListener('click', () => {
    void navigator.clipboard.writeText(cmd).then(() => {
      copyCmd.textContent = '✓ Copied';
      setTimeout(() => (copyCmd.textContent = 'Copy command'), 1600);
    });
  });
  llmResult.append(copyCmd);
}

llmTest.addEventListener('click', () => void testConnection());


function describe(botAccountIndex: number | null): string {
  return botAccountIndex === null
    ? 'Choose the notetaker account to start.'
    : 'Ready — Saar will join your next Meet call.';
}

/**
 * Fills the account dropdown.
 *
 * Keeps a saved index that is no longer in the list rather than silently
 * dropping it: `authuser` numbering shifts when accounts sign in or out, and
 * quietly reassigning the notetaker would mean joining meetings as the wrong
 * person.
 */
function renderAccounts(accounts: readonly GoogleAccount[], saved: number | null): void {
  account.replaceChildren();

  if (accounts.length === 0) {
    account.append(new Option('No Google accounts found', ''));
    account.value = '';
    status.textContent = 'Sign the notetaker account into this Chrome profile, then Refresh.';
    return;
  }

  account.append(new Option('Choose an account…', ''));
  for (const a of accounts) {
    const label = a.name === a.email ? a.email : `${a.name} (${a.email})`;
    const option = new Option(label, String(a.authuser));
    option.title = label; // the popup is 300px wide; the label often truncates
    account.append(option);
  }

  if (saved !== null && !accounts.some((a) => a.authuser === saved)) {
    account.append(new Option(`Account ${saved} (not signed in)`, String(saved)));
  }
  account.value = saved === null ? '' : String(saved);
  status.textContent = describe(saved);
}

const ACCOUNT_CACHE_KEY = 'saar:accounts';

async function cachedAccounts(): Promise<GoogleAccount[]> {
  const raw = await chrome.storage.local.get(ACCOUNT_CACHE_KEY);
  return (raw[ACCOUNT_CACHE_KEY] as GoogleAccount[] | undefined) ?? [];
}

/**
 * Discovery runs HERE, in the popup, not in the service worker.
 *
 * The popup is an extension page with the same host permissions, so the probe
 * works identically — but it avoids a worker that may be asleep, a message
 * round trip, and a response that arrives after the worker has been killed.
 * The result is cached so reopening the popup is instant rather than a
 * four-second stare at an empty dropdown.
 */
async function loadAccounts(): Promise<void> {
  const saved = (await settings.get()).botAccountIndex;
  try {
    const accounts = await listGoogleAccounts();
    await chrome.storage.local.set({ [ACCOUNT_CACHE_KEY]: accounts });
    renderAccounts(accounts, saved);
    if (accounts.length === 0) {
      status.textContent = 'No Google accounts found — are you signed in to Google in Chrome?';
    }
  } catch (e) {
    // Never leave "No accounts found" standing in for an actual error.
    renderAccounts(await cachedAccounts(), saved);
    status.textContent = `Could not read your Google accounts: ${
      e instanceof Error ? e.message : String(e)
    }`;
  }
}

void (async () => {
  const cfg = await settings.get();
  const cached = await cachedAccounts();
  if (cached.length > 0) {
    renderAccounts(cached, cfg.botAccountIndex);
  } else {
    account.replaceChildren(new Option('Loading accounts…', ''));
    status.textContent = describe(cfg.botAccountIndex);
  }
  await loadAccounts();
})();

account.addEventListener('change', () => {
  const next = account.value === '' ? null : Number(account.value);
  status.textContent = describe(next);
  void settings.set({ botAccountIndex: next });
});

accountRefresh.addEventListener('click', (e) => {
  e.preventDefault();
  account.replaceChildren(new Option('Loading accounts…', ''));
  void loadAccounts();
});

open.addEventListener('click', () => openMeetings());
