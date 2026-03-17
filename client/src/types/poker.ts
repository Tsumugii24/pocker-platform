export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  suit: Suit;
  rank: Rank;
}

export type Position = 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';

export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';
export type ActionActor = 'hero' | 'ai' | 'other';

export interface Action {
  position: Position;
  type: ActionType;
  amount?: number;
  potAfter: number;
  timestamp: Date;
  actor?: ActionActor;
  decisionSource?: string;
  decisionDetail?: string;
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river';

export interface StreetHistory {
  street: Street;
  cards?: Card[];
  potBefore: number;
  actions: Action[];
}

export type GamePhase = 'idle' | 'playing' | 'showdown';

export type PotType = 'SRP';

export interface TestConfig {
  heroPosition: Position;
  villainPosition: Position;
  potType: PotType;
  stackDepthBB: number; // total starting stack in BB (e.g. 100)
  dealMode?: 'random' | 'custom';
  customHoleCards?: boolean; // whether to also pick hole cards in custom deal mode
  allowPlayerBluff?: boolean;
  allowAIBluff?: boolean;
  enableMDF?: boolean;
  datasetSource?: 'huggingface' | 'hf-mirror';
  heroActsFirst?: boolean; // true = Hero acts first (OOP), false = AI acts first (OOP)
  showOpponentCards?: boolean;
  showFaceUpOpponentCards?: boolean;
  showAIDecisionNotes?: boolean;
  enableRiverLLMExploit?: boolean;
  enableRiverLLMReasoning?: boolean;
}

export const DEFAULT_TEST_CONFIG: TestConfig = {
  heroPosition: 'BB',
  villainPosition: 'UTG',
  potType: 'SRP',
  stackDepthBB: 100,
  dealMode: 'random',
  customHoleCards: false,
  allowPlayerBluff: true,
  allowAIBluff: true,
  enableMDF: false,
  heroActsFirst: true,
  showOpponentCards: true,
  showFaceUpOpponentCards: false,
  showAIDecisionNotes: false,
  enableRiverLLMExploit: false,
  enableRiverLLMReasoning: false,
};

export interface Player {
  position: Position;
  stack: number; // remaining stack in BB
  cards?: [Card, Card];
  isHero: boolean;
  isActive: boolean; // still in the hand (not folded, seated at table)
  hasFolded: boolean;
  currentBet: number; // amount bet on current street
}

export interface ShowdownResult {
  winnerId: Position | null; // null = split pot
  heroHandRank: string;
  villainHandRank: string;
  potWon: number;
  heroProfit: number; // net +/- relative to start of hand
}

export interface GameState {
  id: string;
  phase: GamePhase;
  config: TestConfig;
  players: Player[];
  communityCards: Card[];
  deck: Card[]; // remaining deck
  pot: number;
  currentStreet: Street;
  currentPosition: Position | null;
  effectiveStack: number;
  history: StreetHistory[];
  handNumber: number;
  currentBet: number; // highest bet on current street that must be matched
  lastRaiseSize: number; // size of the last raise (for min-raise calc)
  initialDeck?: Card[]; // the shuffled deck at the start of the hand
  showdownResult?: ShowdownResult;
}

export interface HandRecord {
  id: string;
  timestamp: Date;
  position: Position;
  opponent: Position;
  effectiveStack: number;
  gameType: string;
  holeCards: [Card, Card];
  board: Card[];
  finalPot: number;
  result: number;
  history: StreetHistory[];
}
