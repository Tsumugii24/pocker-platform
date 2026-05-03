export interface LlmModelOption {
  provider: LlmProviderId;
  id: string;
  name: string;
  size: number;
  supportsThinking: boolean;
  needsThinkingFlag: boolean;
  supportsVision: boolean;
}

export type LlmProviderId = 'modelscope' | 'zenmux' | 'chatgpt-oauth';

export interface LlmProviderOption {
  id: LlmProviderId;
  name: string;
  description: string;
  credentialType: 'api-key' | 'chatgpt-oauth';
  setupHint: string;
  limitLabel?: string;
}

export const LLM_PROVIDERS: LlmProviderOption[] = [
  {
    id: 'modelscope',
    name: 'ModelScope',
    description: 'API key provider for the existing Qwen, DeepSeek, and Kimi model list.',
    credentialType: 'api-key',
    setupHint: 'Set MODELSCOPE_API_KEY and MODELSCOPE_BASE_URL.',
  },
  {
    id: 'zenmux',
    name: 'ZenMux',
    description: 'API key provider for ZenMux OpenAI-compatible requests. GPT-5.x reasoning is shown as a Responses API summary.',
    credentialType: 'api-key',
    setupHint: 'Set ZENMUX_API_KEY. The base URL defaults to https://zenmux.ai/api/v1.',
    limitLabel: '10/day',
  },
  {
    id: 'chatgpt-oauth',
    name: 'ChatGPT OAuth',
    description: 'Uses your local ChatGPT/Codex OAuth login through the openai-oauth proxy.',
    credentialType: 'chatgpt-oauth',
    setupHint: 'Click Login in settings to open the ChatGPT verification page. The backend starts the local proxy after login.',
  },
];

const MODELSCOPE_MODEL_LIST: LlmModelOption[] = [
  {
    provider: 'modelscope',
    id: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
    name: 'Qwen3-235B-A22B-Instruct-2507',
    size: 235,
    supportsThinking: false,
    needsThinkingFlag: false,
    supportsVision: false,
  },
  {
    provider: 'modelscope',
    id: 'Qwen/Qwen3-VL-235B-A22B-Instruct',
    name: 'Qwen3-VL-235B-A22B-Instruct',
    size: 235,
    supportsThinking: false,
    needsThinkingFlag: false,
    supportsVision: true,
  },
  {
    provider: 'modelscope',
    id: 'deepseek-ai/DeepSeek-V3.2',
    name: 'DeepSeek-V3.2',
    size: 685,
    supportsThinking: false,
    needsThinkingFlag: false,
    supportsVision: false,
  },
  {
    provider: 'modelscope',
    id: 'moonshotai/Kimi-K2.5',
    name: 'Kimi-K2.5',
    size: 235,
    supportsThinking: true,
    needsThinkingFlag: true,
    supportsVision: true,
  },
  {
    provider: 'modelscope',
    id: 'Qwen/Qwen3-Next-80B-A3B-Instruct',
    name: 'Qwen3-Next-80B-A3B-Instruct',
    size: 80,
    supportsThinking: false,
    needsThinkingFlag: false,
    supportsVision: false,
  },
  {
    provider: 'modelscope',
    id: 'Qwen/Qwen3-32B',
    name: 'Qwen3-32B',
    size: 32,
    supportsThinking: true,
    needsThinkingFlag: true,
    supportsVision: false,
  },
  {
    provider: 'modelscope',
    id: 'Qwen/Qwen3.5-27B',
    name: 'Qwen3.5-27B',
    size: 27,
    supportsThinking: true,
    needsThinkingFlag: true,
    supportsVision: false,
  },
  {
    provider: 'modelscope',
    id: 'Qwen/Qwen3-14B',
    name: 'Qwen3-14B',
    size: 14,
    supportsThinking: true,
    needsThinkingFlag: true,
    supportsVision: false,
  },
  {
    provider: 'modelscope',
    id: 'Qwen/Qwen3-VL-8B-Instruct',
    name: 'Qwen3-VL-8B-Instruct',
    size: 8,
    supportsThinking: false,
    needsThinkingFlag: false,
    supportsVision: true,
  },
  {
    provider: 'modelscope',
    id: 'Qwen/Qwen3-8B',
    name: 'Qwen3-8B',
    size: 8,
    supportsThinking: true,
    needsThinkingFlag: true,
    supportsVision: false,
  },
];

const ZENMUX_MODEL_LIST: LlmModelOption[] = [
  {
    provider: 'zenmux',
    id: 'openai/gpt-5.5',
    name: 'openai/gpt-5.5',
    size: 0,
    supportsThinking: true,
    needsThinkingFlag: false,
    supportsVision: false,
  },
];

const CHATGPT_OAUTH_MODEL_LIST: LlmModelOption[] = [
  {
    provider: 'chatgpt-oauth',
    id: 'gpt-5.5',
    name: 'gpt-5.5',
    size: 0,
    supportsThinking: true,
    needsThinkingFlag: false,
    supportsVision: false,
  },
  {
    provider: 'chatgpt-oauth',
    id: 'gpt-5.4',
    name: 'gpt-5.4',
    size: 0,
    supportsThinking: true,
    needsThinkingFlag: false,
    supportsVision: false,
  },
];

export const RIVER_EXPLOIT_MODELS = [
  ...MODELSCOPE_MODEL_LIST,
  ...ZENMUX_MODEL_LIST,
  ...CHATGPT_OAUTH_MODEL_LIST,
].sort((a, b) => b.size - a.size);

export const DEFAULT_RIVER_EXPLOIT_PROVIDER_ID: LlmProviderId = 'modelscope';
export const DEFAULT_RIVER_EXPLOIT_MODEL_ID = 'Qwen/Qwen3-32B';
export const DEFAULT_RIVER_EXPLOIT_TIMEOUT_SECONDS = 60;

export function getRiverExploitModelsByProvider(provider?: string | null): LlmModelOption[] {
  const normalizedProvider = getRiverExploitProviderById(provider).id;
  return RIVER_EXPLOIT_MODELS.filter(model => model.provider === normalizedProvider);
}

export function getRiverExploitProviderById(id?: string | null): LlmProviderOption {
  const normalizedId = id === 'openai-oauth' ? 'chatgpt-oauth' : id;
  return (
    LLM_PROVIDERS.find(provider => provider.id === normalizedId) ??
    LLM_PROVIDERS.find(provider => provider.id === DEFAULT_RIVER_EXPLOIT_PROVIDER_ID) ??
    LLM_PROVIDERS[0]
  );
}

export function getDefaultRiverExploitModelForProvider(provider?: string | null): LlmModelOption {
  const providerModels = getRiverExploitModelsByProvider(provider);
  const preferredDefault =
    getRiverExploitProviderById(provider).id === DEFAULT_RIVER_EXPLOIT_PROVIDER_ID
      ? DEFAULT_RIVER_EXPLOIT_MODEL_ID
      : providerModels[0]?.id;
  return (
    providerModels.find(model => model.id === preferredDefault) ??
    providerModels[0] ??
    RIVER_EXPLOIT_MODELS[0]
  );
}

export function getRiverExploitModelById(
  id?: string | null,
  provider?: string | null,
): LlmModelOption {
  const normalizedProvider = getRiverExploitProviderById(provider).id;
  const providerModels = getRiverExploitModelsByProvider(normalizedProvider);
  return (
    providerModels.find(model => model.id === id) ??
    getDefaultRiverExploitModelForProvider(normalizedProvider)
  );
}
