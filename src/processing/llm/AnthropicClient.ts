import type {
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  HealthResult,
  LlmClient,
  ModelInfo,
} from '@/processing/llm/LlmClient';
import { joinUrl } from '@/utils/url';

/**
 * Anthropic's Messages API.
 *
 * A separate client rather than a flag on the OpenAI one, because almost
 * nothing lines up: the path is `/v1/messages`, the key rides `x-api-key`
 * instead of `Authorization: Bearer`, `max_tokens` is required rather than
 * optional, the system prompt is a top-level field instead of a message with
 * `role: "system"`, and the reply is a list of content blocks rather than
 * `choices[0].message.content`.
 */

export interface AnthropicConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

/** Pinned: Anthropic requires it, and an unpinned version can change under us. */
export const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Anthropic blocks browser-origin requests unless this opt-in is present. A
 * POST from an extension carries an `Origin` header (the Fetch spec attaches
 * one to every non-GET request), so without this the summariser 403s while a
 * plain connection test passes.
 */
export const BROWSER_ACCESS_HEADER = 'anthropic-dangerous-direct-browser-access';

interface MessagesResponse {
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string };
}

/** Anthropic takes the system prompt out of band, so it is split off here. */
export function splitSystem(messages: readonly ChatMessage[]): {
  system: string;
  rest: ChatMessage[];
} {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  return { system, rest: messages.filter((m) => m.role !== 'system') };
}

export class AnthropicClient implements LlmClient {
  constructor(
    private readonly config: AnthropicConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      [BROWSER_ACCESS_HEADER]: 'true',
    };
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const { system, rest } = splitSystem(req.messages);

    const body: Record<string, unknown> = {
      model: this.config.model,
      // Required by Anthropic, unlike OpenAI where it is optional.
      max_tokens: req.maxTokens ?? 1500,
      messages: rest.map((m) => ({ role: m.role, content: m.content })),
    };
    if (system !== '') body['system'] = system;
    if (req.temperature !== undefined) body['temperature'] = req.temperature;

    const res = await this.fetchImpl(joinUrl(this.config.baseUrl, 'messages'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: req.signal,
    });

    if (!res.ok) throw new Error(await describeFailure(res));

    const json = (await res.json()) as MessagesResponse;
    // The reply is a list of blocks; only the text ones carry the answer.
    const text = (json.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');

    if (text === '') throw new Error(json.error?.message ?? 'model returned no content');
    return { text };
  }

  async listModels(): Promise<readonly ModelInfo[]> {
    const res = await this.fetchImpl(joinUrl(this.config.baseUrl, 'models'), {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(await describeFailure(res));
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    return (json.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string')
      .map((id) => ({ id }));
  }

  async health(): Promise<HealthResult> {
    try {
      const res = await this.fetchImpl(joinUrl(this.config.baseUrl, 'models'), {
        headers: this.headers(),
      });
      if (res.ok) return { ok: true, status: res.status };
      return { ok: false, status: res.status, detail: await describeFailure(res) };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }
}

async function describeFailure(res: Response): Promise<string> {
  let detail = '';
  try {
    const body = await res.text();
    // Anthropic wraps the useful part in {error: {message}}.
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } };
      detail = parsed.error?.message ?? body.slice(0, 300);
    } catch {
      detail = body.slice(0, 300);
    }
  } catch {
    /* body already consumed or empty */
  }
  if (res.status === 401) return 'the API key was rejected';
  return detail === '' ? `request failed with HTTP ${res.status}` : `HTTP ${res.status}: ${detail}`;
}
