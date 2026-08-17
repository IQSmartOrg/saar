import type { SettingsStore } from '@/settings/types';
import type { LlmProbeResult, Message } from '@/messaging/messages';
import { PROVIDERS, providerById, providerForUrl } from '@/processing/llm/providers';
import { originPattern } from '@/utils/url';
import { byId, el } from '@/ui/dom';

/**
 * Configuring the model that writes the minutes.
 *
 * Nothing leaves the machine until this panel says it should: the toggle is off
 * by default, and every field below it is hidden until it is on.
 */
export function mountAiPanel(settings: SettingsStore): void {
  const enabled = byId<HTMLInputElement>('mom-enabled');
  const config = byId('mom-config');
  const provider = byId<HTMLSelectElement>('llm-provider');
  const url = byId<HTMLInputElement>('llm-url');
  const key = byId<HTMLInputElement>('llm-key');
  const model = byId<HTMLSelectElement>('llm-model');
  const reload = byId<HTMLButtonElement>('llm-refresh');
  const hint = byId('llm-hint');
  const test = byId<HTMLButtonElement>('llm-test');
  const result = byId('llm-result');

  for (const p of PROVIDERS) provider.append(new Option(p.label, p.id));

  /* -- rendering ---------------------------------------------------- */

  /**
   * Fills the model dropdown from whatever the endpoint reports.
   *
   * Keeps the saved model selected even when it is missing from the list — a
   * transient outage must not silently switch which model summarises meetings.
   */
  function renderModels(models: readonly string[], saved: string): void {
    model.replaceChildren();

    if (models.length === 0) {
      model.append(new Option('Connect to load models…', ''));
      model.value = '';
      return;
    }

    for (const id of models) model.append(new Option(id, id));
    if (saved !== '' && !models.includes(saved)) {
      model.append(new Option(`${saved} (not installed)`, saved));
    }
    model.value = saved !== '' ? saved : (models[0] ?? '');

    // Nothing was chosen before, so adopt whatever the dropdown landed on.
    if (saved !== model.value) void settings.set({ llmModel: model.value });
  }

  function clearResult(): void {
    result.replaceChildren();
    result.className = 'hint';
  }

  /** Result line with a coloured tick or cross, so the state reads at a glance. */
  function showResult(ok: boolean, text: string): void {
    result.replaceChildren();
    result.className = `hint result ${ok ? 'ok' : 'bad'}`;
    result.append(el('span', 'mark', ok ? '✓' : '✕'), document.createTextNode(text));
  }

  /**
   * The one-command fix for a local model refusing this extension.
   *
   * Rendered as a copyable command rather than described in prose: the string
   * contains this extension's own id, which nobody can be expected to type.
   */
  function showOriginFix(): void {
    showResult(false, 'Ollama is refusing this extension. Run this, then restart Ollama:');

    const command = `launchctl setenv OLLAMA_ORIGINS "chrome-extension://${chrome.runtime.id}"`;
    result.append(el('code', 'cmd', command));

    const copy = el('button', 'secondary', 'Copy command');
    copy.type = 'button';
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(command).then(() => {
        copy.textContent = '✓ Copied';
        setTimeout(() => (copy.textContent = 'Copy command'), 1600);
      });
    });
    result.append(copy);
  }

  /* -- permissions -------------------------------------------------- */

  /**
   * Asks for host permission on the configured endpoint.
   *
   * This is what makes a local Ollama work with no setup at all: Chrome omits
   * the Origin header on requests to a permitted host, so Ollama's
   * extension-origin block never applies. Without it Chrome sends
   * `Origin: chrome-extension://<id>` and Ollama answers 403.
   *
   * Must be called from a user gesture, which is why it hangs off the toggle
   * and the test button rather than running on load.
   */
  async function ensureHostPermission(): Promise<boolean> {
    const pattern = originPattern(url.value.trim());
    if (pattern === null) return false;
    if (await chrome.permissions.contains({ origins: [pattern] })) return true;
    try {
      return await chrome.permissions.request({ origins: [pattern] });
    } catch {
      return false;
    }
  }

  /* -- the probe ---------------------------------------------------- */

  async function testConnection(): Promise<void> {
    test.disabled = true;
    reload.disabled = true;
    result.className = 'hint';
    result.textContent = 'Testing…';
    try {
      if (!(await ensureHostPermission())) {
        showResult(false, 'Saar needs permission to reach that address.');
        return;
      }

      const probe = (await chrome.runtime.sendMessage({
        type: 'LLM_PROBE',
      } satisfies Message)) as LlmProbeResult | undefined;

      if (!probe?.ok) {
        if (probe?.originBlocked === true) showOriginFix();
        else showResult(false, probe?.detail ?? 'could not reach the model');
        return;
      }

      renderModels(probe.models, (await settings.get()).llmModel);
      showResult(
        true,
        probe.models.length === 0
          ? 'Connected, but no models are available'
          : `Connected · ${probe.models.length} model${probe.models.length === 1 ? '' : 's'}`,
      );
    } finally {
      test.disabled = false;
      reload.disabled = false;
    }
  }

  /* -- wiring ------------------------------------------------------- */

  enabled.addEventListener('change', () => {
    config.hidden = !enabled.checked;
    void settings.set({ momEnabled: enabled.checked });
    // Nothing is sent anywhere until this is on, so confirm the endpoint the
    // moment it is — better to find a broken URL now than after a meeting.
    if (enabled.checked) void testConnection();
  });

  /**
   * Switching provider fills in that provider's endpoint, key and model.
   *
   * Everything it writes stays editable — the preset is a starting point, and a
   * user who has customised an endpoint keeps their edits until they explicitly
   * pick a different provider.
   */
  provider.addEventListener('change', () => {
    const picked = providerById(provider.value);
    url.value = picked.baseUrl;
    key.value = picked.apiKey;
    hint.textContent = picked.hint;
    renderModels(picked.defaultModel === '' ? [] : [picked.defaultModel], picked.defaultModel);
    clearResult();

    void settings.set({
      llmProviderId: picked.id,
      llmBaseUrl: picked.baseUrl,
      llmApiKey: picked.apiKey,
      llmModel: picked.defaultModel,
    });

    // A local provider needs no key, so there is nothing to wait for.
    if (picked.apiKey !== '') void testConnection();
  });

  // URL or key changed: the old model list belongs to a different endpoint, so
  // say so rather than letting a stale option look valid.
  for (const [field, setting] of [
    [url, 'llmBaseUrl'],
    [key, 'llmApiKey'],
  ] as const) {
    field.addEventListener('change', () => {
      void settings.set({ [setting]: field.value.trim() });
      result.textContent = 'Endpoint changed — test the connection to load its models.';
    });
  }

  model.addEventListener('change', () => void settings.set({ llmModel: model.value }));
  test.addEventListener('click', () => void testConnection());
  // Reloading the model list is the same probe, so the button shares it.
  reload.addEventListener('click', () => void testConnection());

  void (async () => {
    const cfg = await settings.get();
    enabled.checked = cfg.momEnabled;
    config.hidden = !cfg.momEnabled;
    url.value = cfg.llmBaseUrl;
    key.value = cfg.llmApiKey;

    // Settings saved before presets existed carry no provider id — infer one
    // from the URL so the dropdown opens on the right entry.
    const picked =
      cfg.llmProviderId === '' ? providerForUrl(cfg.llmBaseUrl) : providerById(cfg.llmProviderId);
    provider.value = picked.id;
    hint.textContent = picked.hint;

    renderModels(cfg.llmModel === '' ? [] : [cfg.llmModel], cfg.llmModel);
    // Already configured: refresh the list quietly so the dropdown is live
    // without the user having to press Test.
    if (cfg.momEnabled) void testConnection();
  })();
}
