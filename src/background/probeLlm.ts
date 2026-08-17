import type { SettingsStore } from '@/settings/types';
import { createLlmClient } from '@/processing/llm/createClient';
import type { LlmProbeResult } from '@/messaging/messages';

/**
 * The settings panel's "Test connection", answered from the worker.
 *
 * Reachability and the model list in one round trip, because the panel always
 * wants both: it cannot offer a model dropdown without the list, and a list it
 * could not fetch is exactly what "not connected" means.
 */
export async function probeLlm(settings: SettingsStore): Promise<LlmProbeResult> {
  const cfg = await settings.get();
  const client = createLlmClient({
    providerId: cfg.llmProviderId,
    baseUrl: cfg.llmBaseUrl,
    apiKey: cfg.llmApiKey,
    model: cfg.llmModel,
  });

  // health() first: a GET succeeds even when the POST that writes the minutes
  // would be refused, so the connection test has to ask the question the
  // summariser will actually face.
  const health = await client.health();
  if (!health.ok) {
    return {
      ok: false,
      models: [],
      detail: health.detail,
      ...(health.originBlocked === true ? { originBlocked: true } : {}),
    };
  }

  try {
    const models = await client.listModels();
    return { ok: true, models: models.map((m) => m.id) };
  } catch (e) {
    return { ok: false, models: [], detail: e instanceof Error ? e.message : String(e) };
  }
}
