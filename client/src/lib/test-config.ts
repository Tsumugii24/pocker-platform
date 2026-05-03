import {
  DEFAULT_TEST_CONFIG,
  type Position,
  type RiverExploitPromptLanguage,
  type TestConfig,
} from '@/types/poker';
import {
  DEFAULT_RIVER_EXPLOIT_MODEL_ID,
  DEFAULT_RIVER_EXPLOIT_PROVIDER_ID,
  DEFAULT_RIVER_EXPLOIT_TIMEOUT_SECONDS,
  getRiverExploitModelById,
  getRiverExploitProviderById,
} from '@/lib/llm-models';

interface EffectivePositions {
  heroPosition: Position;
  villainPosition: Position;
}

export function getEffectivePositions(config: Partial<TestConfig>): EffectivePositions {
  const heroIsIP = config.heroActsFirst === false;
  return {
    heroPosition: heroIsIP ? 'UTG' : 'BB',
    villainPosition: heroIsIP ? 'BB' : 'UTG',
  };
}

export function normalizeTestConfig(config?: Partial<TestConfig>): TestConfig {
  const merged: TestConfig = {
    ...DEFAULT_TEST_CONFIG,
    ...(config ?? {}),
  };
  const promptLanguage: RiverExploitPromptLanguage =
    merged.riverExploitPromptLanguage === 'zh' ? 'zh' : 'en';
  const selectedProvider = getRiverExploitProviderById(merged.riverExploitProvider);
  const selectedModel = getRiverExploitModelById(
    merged.riverExploitModel,
    selectedProvider.id,
  );
  const normalizedTimeoutSecondsRaw = Number(merged.riverExploitTimeoutSeconds);
  const normalizedTimeoutSeconds = Number.isFinite(normalizedTimeoutSecondsRaw)
    ? Math.min(Math.max(Math.round(normalizedTimeoutSecondsRaw), 1), 600)
    : DEFAULT_RIVER_EXPLOIT_TIMEOUT_SECONDS;

  return {
    ...merged,
    enableRiverLLMReasoning: selectedModel.supportsThinking
      ? Boolean(merged.enableRiverLLMReasoning)
      : false,
    riverExploitPromptLanguage: promptLanguage,
    riverExploitProvider: selectedProvider.id ?? DEFAULT_RIVER_EXPLOIT_PROVIDER_ID,
    riverExploitModel: selectedModel.id ?? DEFAULT_RIVER_EXPLOIT_MODEL_ID,
    riverExploitTimeoutSeconds: normalizedTimeoutSeconds,
    ...getEffectivePositions(merged),
  };
}
