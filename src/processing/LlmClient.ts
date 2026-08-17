/**
 * The seam in front of the model.
 *
 * One shape, speaking OpenAI Chat Completions. Ollama is not a special case —
 * it serves `/v1` and ignores the API key, so a local model and a hosted
 * provider are the same code path with different settings.
 */
export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface CompletionRequest {
  readonly messages: readonly ChatMessage[];
  /**
   * Best-effort only. Support is uneven across providers, so callers must
   * always also prompt for JSON and parse defensively.
   */
  readonly jsonSchema?: object;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly signal?: AbortSignal;
}

export interface CompletionResult {
  readonly text: string;
}

export interface ModelInfo {
  readonly id: string;
}

export interface HealthResult {
  readonly ok: boolean;
  readonly status?: number;
  readonly detail?: string;
  /**
   * A local model refused the extension's origin.
   *
   * Reachable even when a plain connection test passes: per the Fetch spec an
   * `Origin` header is attached to every request whose method is not GET or
   * HEAD, so `GET /v1/models` goes out bare and succeeds while the `POST` that
   * actually writes the minutes carries an origin Ollama rejects with 403.
   * Testing only the GET is what made this look solved when it was not.
   */
  readonly originBlocked?: boolean;
}

/** True for a URL Ollama would be serving. */
export function isLocalEndpoint(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

export interface LlmClient {
  complete(req: CompletionRequest): Promise<CompletionResult>;
  listModels(): Promise<readonly ModelInfo[]>;
  health(): Promise<HealthResult>;
}
