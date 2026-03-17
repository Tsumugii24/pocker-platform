import { DEFAULT_TEST_CONFIG, type Position, type TestConfig } from '@/types/poker';

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

  return {
    ...merged,
    ...getEffectivePositions(merged),
  };
}
