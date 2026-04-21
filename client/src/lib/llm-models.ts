export interface LlmModelOption {
  id: string;
  name: string;
  size: number;
  supportsThinking: boolean;
  needsThinkingFlag: boolean;
  supportsVision: boolean;
}

const MODEL_LIST: LlmModelOption[] = [
  {
    id: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
    name: 'Qwen3-235B-A22B-Instruct-2507',
    size: 235,
    supportsThinking: false,
    needsThinkingFlag: false,
    supportsVision: false,
  },
  {
    id: 'Qwen/Qwen3-VL-235B-A22B-Instruct',
    name: 'Qwen3-VL-235B-A22B-Instruct',
    size: 235,
    supportsThinking: false,
    needsThinkingFlag: false,
    supportsVision: true,
  },
  {
    id: 'deepseek-ai/DeepSeek-V3.2',
    name: 'DeepSeek-V3.2',
    size: 685,
    supportsThinking: false,
    needsThinkingFlag: false,
    supportsVision: false,
  },
  {
    id: 'moonshotai/Kimi-K2.5',
    name: 'Kimi-K2.5',
    size: 235,
    supportsThinking: true,
    needsThinkingFlag: true,
    supportsVision: true,
  },
  {
    id: 'Qwen/Qwen3-Next-80B-A3B-Instruct',
    name: 'Qwen3-Next-80B-A3B-Instruct',
    size: 80,
    supportsThinking: false,
    needsThinkingFlag: false,
    supportsVision: false,
  },
  {
    id: 'Qwen/Qwen3-32B',
    name: 'Qwen3-32B',
    size: 32,
    supportsThinking: true,
    needsThinkingFlag: true,
    supportsVision: false,
  },
  {
    id: 'Qwen/Qwen3.5-27B',
    name: 'Qwen3.5-27B',
    size: 27,
    supportsThinking: true,
    needsThinkingFlag: true,
    supportsVision: false,
  },
  {
    id: 'Qwen/Qwen3-14B',
    name: 'Qwen3-14B',
    size: 14,
    supportsThinking: true,
    needsThinkingFlag: true,
    supportsVision: false,
  },
  {
    id: 'Qwen/Qwen3-VL-8B-Instruct',
    name: 'Qwen3-VL-8B-Instruct',
    size: 8,
    supportsThinking: false,
    needsThinkingFlag: false,
    supportsVision: true,
  },
  {
    id: 'Qwen/Qwen3-8B',
    name: 'Qwen3-8B',
    size: 8,
    supportsThinking: true,
    needsThinkingFlag: true,
    supportsVision: false,
  },
];

export const RIVER_EXPLOIT_MODELS = [...MODEL_LIST].sort((a, b) => b.size - a.size);

export const DEFAULT_RIVER_EXPLOIT_MODEL_ID = 'Qwen/Qwen3-32B';
export const DEFAULT_RIVER_EXPLOIT_TIMEOUT_SECONDS = 60;

export function getRiverExploitModelById(id?: string | null): LlmModelOption {
  return (
    RIVER_EXPLOIT_MODELS.find(model => model.id === id) ??
    RIVER_EXPLOIT_MODELS.find(model => model.id === DEFAULT_RIVER_EXPLOIT_MODEL_ID) ??
    RIVER_EXPLOIT_MODELS[0]
  );
}
