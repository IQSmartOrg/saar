import type {
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  HealthResult,
  LlmClient,
  ModelInfo,
} from '@/processing/llm/LlmClient';
import { isLocalEndpoint, joinUrl } from '@/utils/url';
import { logger } from '@/utils/logger';

const log = logger('processing.llm.openai');

/**
 * Ollama's default answer to a browser extension.
 *
 * Worth spelling out rather than surfacing a bare "HTTP 403": the cause is one
 * unset environment variable and the fix is a single command, but nothing about
 * the status code says so.
 */
export const ORIGIN_BLOCKED_HINT =
  'the local model refused this extension. Set OLLAMA_ORIGINS to allow it, then restart Ollama';

/**
 * One client speaking OpenAI Chat Completions.
 *
 * Ollama is not a special case — it serves `/v1` and ignores the API key — so
 * local and hosted providers are the same code path with different settings.
 */

export interface ProviderConfig {
  /** e.g. http://localhost:11434/v1 or https://api.openai.com/v1 */
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

export class OpenAiCompatibleClient implements LlmClient {
  constructor(
    private readonly config: ProviderConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey}`,
    };
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: req.messages as ChatMessage[],
      stream: false,
    };
    if (req.temperature !== undefined) body['temperature'] = req.temperature;
    if (req.maxTokens !== undefined) body['max_tokens'] = req.maxTokens;
    // Best-effort. Ignored by some providers, which is why every caller also
    // prompts for JSON and parses defensively.
    if (req.jsonSchema) {
      body['response_format'] = {
        type: 'json_schema',
        json_schema: { name: 'minutes', schema: req.jsonSchema },
      };
    }

    const res = await this.fetchImpl(joinUrl(this.config.baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: req.signal,
    });

    if (!res.ok) {
      log.severe('completion failed', { status: res.status, model: this.config.model });
      // Retry without response_format: providers that reject the field answer
      // 400, and the prompt alone is usually enough to get valid JSON back.
      if (res.status === 400 && req.jsonSchema) {
        const { jsonSchema: _dropped, ...rest } = req;
        return this.complete(rest);
      }
      // A POST carries an Origin header even when a GET does not, so this is
      // where a local model's origin block actually bites.
      if (res.status === 403 && isLocalEndpoint(this.config.baseUrl)) {
        throw new Error(ORIGIN_BLOCKED_HINT);
      }
      throw new Error(await describeFailure(res));
    }

    const json = (await res.json()) as ChatResponse;
    const text = json.choices?.[0]?.message?.content;
    if (typeof text !== 'string') {
      throw new Error(json.error?.message ?? 'model returned no content');
    }
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

      const originBlocked = res.status === 403 && isLocalEndpoint(this.config.baseUrl);
      return {
        ok: false,
        status: res.status,
        originBlocked,
        detail: originBlocked ? ORIGIN_BLOCKED_HINT : await describeFailure(res),
      };
    } catch (e) {
      return {
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      };
    }
  }
}

async function describeFailure(res: Response): Promise<string> {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 300);
  } catch {
    /* body already consumed or empty */
  }
  return detail === ''
    ? `request failed with HTTP ${res.status}`
    : `HTTP ${res.status}: ${detail}`;
}
