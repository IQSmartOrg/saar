/**
 * The providers Saar can summarise with.
 *
 * A preset is a starting point, not a lock-in: picking one fills in the URL,
 * the key placeholder and a sensible default model, and every field stays
 * editable. `custom` exists so an unlisted OpenAI-compatible endpoint is a
 * first-class choice rather than a workaround.
 */

/** Which client speaks to this provider. */
export type ProviderApi = 'openai' | 'anthropic';

export interface Provider {
  readonly id: string;
  readonly label: string;
  readonly api: ProviderApi;
  readonly baseUrl: string;
  /** Prefilled key. Only meaningful where the provider ignores it. */
  readonly apiKey: string;
  readonly defaultModel: string;
  /** Shown under the fields — where to get a key, or why none is needed. */
  readonly hint: string;
  /** Providers that publish a model list; the rest need the model typed. */
  readonly listsModels: boolean;
}

export const PROVIDERS: readonly Provider[] = [
  {
    id: 'ollama',
    label: 'Ollama (on this machine)',
    api: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    // Ollama ignores the key entirely; the field must simply be non-empty.
    apiKey: 'ollama',
    defaultModel: '',
    hint: 'Nothing leaves this machine. Saar reads the models you have already pulled.',
    listsModels: true,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    api: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    defaultModel: 'gpt-4o-mini',
    hint: 'Create a key at platform.openai.com → API keys.',
    listsModels: true,
  },
  {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    // Not OpenAI-shaped: /v1/messages, x-api-key, and a top-level system
    // field. It gets its own client rather than a tweaked OpenAI one.
    api: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: '',
    defaultModel: 'claude-opus-5',
    hint: 'Create a key at console.anthropic.com → API keys.',
    listsModels: true,
  },
  {
    id: 'groq',
    label: 'Groq',
    api: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: '',
    defaultModel: 'llama-3.3-70b-versatile',
    hint: 'Create a key at console.groq.com → API keys.',
    listsModels: true,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    api: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    defaultModel: '',
    hint: 'One key for many models. Create it at openrouter.ai → Keys.',
    listsModels: true,
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (on this machine)',
    api: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    apiKey: 'lm-studio',
    defaultModel: '',
    hint: 'Start the local server from LM Studio’s Developer tab first.',
    listsModels: true,
  },
  {
    id: 'custom',
    label: 'Other (OpenAI-compatible)',
    api: 'openai',
    baseUrl: '',
    apiKey: '',
    defaultModel: '',
    hint: 'Any endpoint that speaks the OpenAI chat-completions API.',
    listsModels: true,
  },
];

export const DEFAULT_PROVIDER_ID = 'ollama';

export function providerById(id: string): Provider {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]!;
}

/**
 * Best guess at which provider a stored URL belongs to.
 *
 * Only used to preselect the dropdown for someone who configured Saar before
 * presets existed — a wrong guess costs one click, so matching on host is
 * enough and no URL is ever rewritten on the strength of it.
 */
export function providerForUrl(baseUrl: string): Provider {
  let host: string;
  try {
    host = new URL(baseUrl).host;
  } catch {
    return providerById('custom');
  }
  const match = PROVIDERS.find((p) => {
    if (p.baseUrl === '') return false;
    try {
      return new URL(p.baseUrl).host === host;
    } catch {
      return false;
    }
  });
  return match ?? providerById('custom');
}
