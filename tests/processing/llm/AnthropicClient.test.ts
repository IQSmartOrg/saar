import { describe, it, expect } from 'vitest';
import { AnthropicClient, splitSystem, ANTHROPIC_VERSION } from '@/processing/llm/AnthropicClient';

interface Captured {
  url: string;
  init: RequestInit;
}

function fakeFetch(
  captured: Captured[],
  response: { ok?: boolean; status?: number; body?: unknown } = {},
): typeof fetch {
  return ((url: string, init: RequestInit) => {
    captured.push({ url, init });
    return Promise.resolve({
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: () => Promise.resolve(response.body ?? { content: [{ type: 'text', text: 'hi' }] }),
      text: () => Promise.resolve(JSON.stringify(response.body ?? {})),
    });
  }) as unknown as typeof fetch;
}

const config = { baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk-test', model: 'claude-opus-5' };

describe('splitSystem', () => {
  it('lifts the system prompt out of the message list', () => {
    // Anthropic takes it as a top-level field, not a role in messages.
    const { system, rest } = splitSystem([
      { role: 'system', content: 'You are terse.' },
      { role: 'user', content: 'Hello' },
    ]);
    expect(system).toBe('You are terse.');
    expect(rest).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('joins several system messages', () => {
    const { system } = splitSystem([
      { role: 'system', content: 'One.' },
      { role: 'system', content: 'Two.' },
      { role: 'user', content: 'Hi' },
    ]);
    expect(system).toBe('One.\n\nTwo.');
  });

  it('leaves a system-free conversation untouched', () => {
    const { system, rest } = splitSystem([{ role: 'user', content: 'Hi' }]);
    expect(system).toBe('');
    expect(rest).toHaveLength(1);
  });
});

describe('request shape', () => {
  it('posts to /messages, not /chat/completions', async () => {
    const captured: Captured[] = [];
    await new AnthropicClient(config, fakeFetch(captured)).complete({
      messages: [{ role: 'user', content: 'Hi' }],
    });
    expect(captured[0]!.url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('authenticates with x-api-key rather than a bearer token', async () => {
    const captured: Captured[] = [];
    await new AnthropicClient(config, fakeFetch(captured)).complete({
      messages: [{ role: 'user', content: 'Hi' }],
    });
    const headers = captured[0]!.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['Authorization']).toBeUndefined();
    expect(headers['anthropic-version']).toBe(ANTHROPIC_VERSION);
  });

  it('opts into direct browser access', async () => {
    // A POST from an extension carries an Origin header, which Anthropic
    // rejects without this opt-in.
    const captured: Captured[] = [];
    await new AnthropicClient(config, fakeFetch(captured)).complete({
      messages: [{ role: 'user', content: 'Hi' }],
    });
    const headers = captured[0]!.init.headers as Record<string, string>;
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  });

  it('always sends max_tokens, which Anthropic requires', async () => {
    const captured: Captured[] = [];
    await new AnthropicClient(config, fakeFetch(captured)).complete({
      messages: [{ role: 'user', content: 'Hi' }],
    });
    const body = JSON.parse(captured[0]!.init.body as string);
    expect(body.max_tokens).toBeGreaterThan(0);
  });

  it('sends the system prompt as a top-level field', async () => {
    const captured: Captured[] = [];
    await new AnthropicClient(config, fakeFetch(captured)).complete({
      messages: [
        { role: 'system', content: 'Be terse.' },
        { role: 'user', content: 'Hi' },
      ],
    });
    const body = JSON.parse(captured[0]!.init.body as string);
    expect(body.system).toBe('Be terse.');
    expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);
  });
});

describe('response handling', () => {
  it('joins the text content blocks', async () => {
    const client = new AnthropicClient(
      config,
      fakeFetch([], {
        body: {
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'thinking', text: 'ignored' },
            { type: 'text', text: 'world' },
          ],
        },
      }),
    );
    expect((await client.complete({ messages: [{ role: 'user', content: 'Hi' }] })).text).toBe(
      'Hello world',
    );
  });

  it('names a rejected key rather than surfacing a bare 401', async () => {
    const client = new AnthropicClient(config, fakeFetch([], { ok: false, status: 401 }));
    await expect(client.complete({ messages: [{ role: 'user', content: 'Hi' }] })).rejects.toThrow(
      /API key was rejected/,
    );
  });

  it('surfaces the provider message on other failures', async () => {
    const client = new AnthropicClient(
      config,
      fakeFetch([], { ok: false, status: 400, body: { error: { message: 'model not found' } } }),
    );
    await expect(client.complete({ messages: [{ role: 'user', content: 'Hi' }] })).rejects.toThrow(
      /model not found/,
    );
  });

  it('reports health without throwing when the endpoint is unreachable', async () => {
    const failing = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    const health = await new AnthropicClient(config, failing).health();
    expect(health.ok).toBe(false);
    expect(health.detail).toContain('offline');
  });
});
