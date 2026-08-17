import type { LlmClient } from '@/processing/LlmClient';
import { AnthropicClient } from '@/processing/AnthropicClient';
import { OpenAiCompatibleClient } from '@/processing/OpenAiCompatibleClient';
import { providerById } from '@/processing/providers';

export interface ClientConfig {
  readonly providerId: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

/**
 * Picks the client that speaks the configured provider's API.
 *
 * The one place the provider list touches the rest of the system — everything
 * downstream sees only the `LlmClient` port, so adding a provider whose API is
 * shaped differently means a new client here and nothing else.
 */
export function createLlmClient(cfg: ClientConfig, fetchImpl?: typeof fetch): LlmClient {
  const provider = providerById(cfg.providerId);
  const args = { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model };
  return provider.api === 'anthropic'
    ? new AnthropicClient(args, fetchImpl)
    : new OpenAiCompatibleClient(args, fetchImpl);
}
