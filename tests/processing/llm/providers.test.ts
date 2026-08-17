import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PROVIDER_ID,
  PROVIDERS,
  providerById,
  providerForUrl,
} from '@/processing/llm/providers';
import { createLlmClient } from '@/processing/llm/createClient';
import { AnthropicClient } from '@/processing/llm/AnthropicClient';
import { OpenAiCompatibleClient } from '@/processing/llm/OpenAiCompatibleClient';

describe('the provider list', () => {
  it('has a unique id and a label for every entry', () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PROVIDERS) expect(p.label).toBeTruthy();
  });

  it('offers a custom entry so an unlisted endpoint is a real choice', () => {
    const custom = PROVIDERS.find((p) => p.id === 'custom');
    expect(custom).toBeDefined();
    expect(custom!.baseUrl).toBe('');
  });

  it('prefills a key only where the provider ignores it', () => {
    // A prefilled key on a paid provider would look like a working setup.
    for (const p of PROVIDERS) {
      if (p.apiKey === '') continue;
      expect(p.baseUrl).toMatch(/localhost|127\.0\.0\.1/);
    }
  });

  it('defaults to the local, private option', () => {
    expect(providerById(DEFAULT_PROVIDER_ID).baseUrl).toContain('localhost');
  });

  it('falls back to the first provider for an unknown id', () => {
    expect(providerById('nope').id).toBe(PROVIDERS[0]!.id);
  });
});

describe('providerForUrl', () => {
  it('recognises a configured endpoint by host', () => {
    expect(providerForUrl('http://localhost:11434/v1').id).toBe('ollama');
    expect(providerForUrl('https://api.openai.com/v1').id).toBe('openai');
    expect(providerForUrl('https://api.anthropic.com/v1').id).toBe('anthropic');
  });

  it('treats anything unrecognised as custom rather than guessing', () => {
    expect(providerForUrl('https://llm.internal.example/v1').id).toBe('custom');
  });

  it('does not throw on a malformed URL', () => {
    expect(providerForUrl('not a url').id).toBe('custom');
  });
});

describe('createLlmClient', () => {
  it('uses the Anthropic client for Claude', () => {
    // Anthropic is not OpenAI-shaped: different path, header, and body.
    const client = createLlmClient({
      providerId: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'k',
      model: 'claude-opus-5',
    });
    expect(client).toBeInstanceOf(AnthropicClient);
  });

  it.each(['ollama', 'openai', 'groq', 'openrouter', 'lmstudio', 'custom'])(
    'uses the OpenAI-compatible client for %s',
    (providerId) => {
      const client = createLlmClient({ providerId, baseUrl: 'http://x/v1', apiKey: 'k', model: 'm' });
      expect(client).toBeInstanceOf(OpenAiCompatibleClient);
    },
  );
});
