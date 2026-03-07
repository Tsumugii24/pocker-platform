import type {
  Card,
  GameState,
  Position,
  Street,
  HandRecord,
  StreetHistory,
  Player,
  TestConfig,
  ShowdownResult,
} from '@/types/poker';

// ─── Card Utilities ──────────────────────────────────────────────────────────

const SUITS: Card['suit'][] = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS: Card['rank'][] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const RANK_VALUES: Record<Card['rank'], number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function dealCards(deck: Card[], count: number): { cards: Card[]; remaining: Card[] } {
  return {
    cards: deck.slice(0, count),
    remaining: deck.slice(count),
  };
}

// ─── Hand Evaluation ─────────────────────────────────────────────────────────

type HandCategory =
  | 'straight_flush'
  | 'four_of_a_kind'
  | 'full_house'
  | 'flush'
  | 'straight'
  | 'three_of_a_kind'
  | 'two_pair'
  | 'pair'
  | 'high_card';

const HAND_RANK: Record<HandCategory, number> = {
  straight_flush: 8,
  four_of_a_kind: 7,
  full_house: 6,
  flush: 5,
  straight: 4,
  three_of_a_kind: 3,
  two_pair: 2,
  pair: 1,
  high_card: 0,
};

const HAND_LABELS: Record<HandCategory, string> = {
  straight_flush: 'Straight Flush',
  four_of_a_kind: 'Four of a Kind',
  full_house: 'Full House',
  flush: 'Flush',
  straight: 'Straight',
  three_of_a_kind: 'Three of a Kind',
  two_pair: 'Two Pair',
  pair: 'Pair',
  high_card: 'High Card',
};

interface EvaluatedHand {
  category: HandCategory;
  /** comparison key: [categoryRank, tiebreakers...] bigger = better */
  score: number[];
  description: string;
}

/** Generate all C(n,5) combinations */
function combinations5(cards: Card[]): Card[][] {
  const result: Card[][] = [];
  const n = cards.length;
  for (let i = 0; i < n - 4; i++)
    for (let j = i + 1; j < n - 3; j++)
      for (let k = j + 1; k < n - 2; k++)
        for (let l = k + 1; l < n - 1; l++)
          for (let m = l + 1; m < n; m++)
            result.push([cards[i], cards[j], cards[k], cards[l], cards[m]]);
  return result;
}

function evaluate5(cards: Card[]): EvaluatedHand {
  const values = cards.map(c => RANK_VALUES[c.rank]).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);

  const isFlush = suits.every(s => s === suits[0]);

  // Check straight (including A-low: A2345)
  let isStraight = false;
  let straightHigh = 0;
  if (values[0] - values[4] === 4 && new Set(values).size === 5) {
    isStraight = true;
    straightHigh = values[0];
  } else if (
    values[0] === 14 &&
    values[1] === 5 &&
    values[2] === 4 &&
    values[3] === 3 &&
    values[4] === 2
  ) {
    isStraight = true;
    straightHigh = 5; // wheel: 5-high straight
  }

  // Count ranks
  const counts: Record<number, number> = {};
  for (const v of values) counts[v] = (counts[v] || 0) + 1;
  const groups = Object.entries(counts)
    .map(([val, cnt]) => ({ val: Number(val), cnt }))
    .sort((a, b) => b.cnt - a.cnt || b.val - a.val);

  if (isFlush && isStraight) {
    return {
      category: 'straight_flush',
      score: [HAND_RANK.straight_flush, straightHigh],
      description: `Straight Flush, ${rankName(straightHigh)} high`,
    };
  }

  if (groups[0].cnt === 4) {
    return {
      category: 'four_of_a_kind',
      score: [HAND_RANK.four_of_a_kind, groups[0].val, groups[1].val],
      description: `Four of a Kind, ${rankName(groups[0].val)}s`,
    };
  }

  if (groups[0].cnt === 3 && groups[1].cnt === 2) {
    return {
      category: 'full_house',
      score: [HAND_RANK.full_house, groups[0].val, groups[1].val],
      description: `Full House, ${rankName(groups[0].val)}s full of ${rankName(groups[1].val)}s`,
    };
  }

  if (isFlush) {
    return {
      category: 'flush',
      score: [HAND_RANK.flush, ...values],
      description: `Flush, ${rankName(values[0])} high`,
    };
  }

  if (isStraight) {
    return {
      category: 'straight',
      score: [HAND_RANK.straight, straightHigh],
      description: `Straight, ${rankName(straightHigh)} high`,
    };
  }

  if (groups[0].cnt === 3) {
    const kickers = groups.slice(1).map(g => g.val).sort((a, b) => b - a);
    return {
      category: 'three_of_a_kind',
      score: [HAND_RANK.three_of_a_kind, groups[0].val, ...kickers],
      description: `Three of a Kind, ${rankName(groups[0].val)}s`,
    };
  }

  if (groups[0].cnt === 2 && groups[1].cnt === 2) {
    const pairs = [groups[0].val, groups[1].val].sort((a, b) => b - a);
    const kicker = groups[2].val;
    return {
      category: 'two_pair',
      score: [HAND_RANK.two_pair, pairs[0], pairs[1], kicker],
      description: `Two Pair, ${rankName(pairs[0])}s and ${rankName(pairs[1])}s`,
    };
  }

  if (groups[0].cnt === 2) {
    const kickers = groups.slice(1).map(g => g.val).sort((a, b) => b - a);
    return {
      category: 'pair',
      score: [HAND_RANK.pair, groups[0].val, ...kickers],
      description: `Pair of ${rankName(groups[0].val)}s`,
    };
  }

  return {
    category: 'high_card',
    score: [HAND_RANK.high_card, ...values],
    description: `High Card ${rankName(values[0])}`,
  };
}

function rankName(val: number): string {
  const names: Record<number, string> = {
    14: 'Ace', 13: 'King', 12: 'Queen', 11: 'Jack', 10: 'Ten',
    9: 'Nine', 8: 'Eight', 7: 'Seven', 6: 'Six', 5: 'Five',
    4: 'Four', 3: 'Three', 2: 'Two',
  };
  return names[val] || String(val);
}

/** Evaluate best 5-card hand from 7 cards */
export function evaluateHand(cards: Card[]): EvaluatedHand {
  const combos = combinations5(cards);
  let best: EvaluatedHand | null = null;
  for (const combo of combos) {
    const evaled = evaluate5(combo);
    if (!best || compareScores(evaled.score, best.score) > 0) {
      best = evaled;
    }
  }
  return best!;
}

function compareScores(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

/** Compare two hands: >0 means hand1 wins, <0 means hand2 wins, 0 = tie */
export function compareHands(hand1: Card[], hand2: Card[]): number {
  const eval1 = evaluateHand(hand1);
  const eval2 = evaluateHand(hand2);
  return compareScores(eval1.score, eval2.score);
}

// ─── Street Logic ────────────────────────────────────────────────────────────

export function advanceStreet(currentStreet: Street): Street | null {
  const order: Street[] = ['preflop', 'flop', 'turn', 'river'];
  const idx = order.indexOf(currentStreet);
  return idx < order.length - 1 ? order[idx + 1] : null;
}

export function getCardsForStreet(street: Street, deck: Card[]): { cards: Card[]; remaining: Card[] } {
  if (street === 'flop') return dealCards(deck, 3);
  if (street === 'turn' || street === 'river') return dealCards(deck, 1);
  return { cards: [], remaining: deck };
}

// ─── Opponent AI ─────────────────────────────────────────────────────────────

export function getOpponentAction(
  pot: number,
  currentBet: number,
  opponentCurrentBet: number,
  opponentStack: number,
): { action: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin'; amount?: number } {
  const toCall = currentBet - opponentCurrentBet;

  // If all-in or no stack left, can only check or fold
  if (opponentStack <= 0) {
    return toCall > 0 ? { action: 'fold' } : { action: 'check' };
  }

  const random = Math.random();

  if (toCall === 0) {
    // No bet to call — check or bet
    if (random < 0.45) {
      return { action: 'check' };
    } else {
      // Bet between 33%-100% of pot
      const betFraction = 0.33 + random * 0.67;
      let betAmount = Math.max(1, Math.round(pot * betFraction * 2) / 2); // round to 0.5
      if (betAmount >= opponentStack) {
        return { action: 'allin', amount: opponentStack };
      }
      return { action: 'bet', amount: betAmount };
    }
  } else {
    // Has bet to call
    if (toCall >= opponentStack) {
      // Must go all-in to call
      if (random < 0.3) return { action: 'fold' };
      return { action: 'allin', amount: opponentStack };
    }

    if (random < 0.2) {
      return { action: 'fold' };
    } else if (random < 0.7) {
      return { action: 'call', amount: toCall };
    } else {
      // Raise: raise to 2.5x-3.5x the current bet
      const multiplier = 2.5 + random;
      let raiseTotal = Math.round(currentBet * multiplier * 2) / 2;
      if (raiseTotal >= opponentStack + opponentCurrentBet) {
        return { action: 'allin', amount: opponentStack };
      }
      const raiseSize = raiseTotal - opponentCurrentBet;
      return { action: 'raise', amount: raiseSize };
    }
  }
}

// ─── SRP Game Initialization ─────────────────────────────────────────────────

/**
 * Create a Single Raised Pot (SRP) game starting on the Flop.
 *
 * Preflop has already been resolved:
 *   6-max table. SB posts 0.5BB, BB posts 1BB.
 *   UTG raises to 2.5BB. HJ/CO/BTN fold. SB folds.
 *   BB calls (adds 1.5BB more).
 *   Pot = 0.5 (SB dead) + 2.5 (BB total) + 2.5 (UTG total) = 5.5BB
 *   Both BB and UTG have 100 - 2.5 = 97.5BB remaining.
 *
 * Postflop: BB (OOP) acts first on every street.
 */
export function createSRPGame(handNumber: number = 1, config?: TestConfig): GameState {
  const cfg: TestConfig = config ?? {
    heroPosition: 'BB',
    villainPosition: 'UTG',
    potType: 'SRP',
    stackDepthBB: 100,
  };

  let deck = shuffleDeck(createDeck());

  // Deal hole cards
  const { cards: heroCards, remaining: deck1 } = dealCards(deck, 2);
  const { cards: villainCards, remaining: deck2 } = dealCards(deck1, 2);
  deck = deck2;

  // Deal flop
  const { cards: flopCards, remaining: deck3 } = dealCards(deck, 3);
  deck = deck3;

  // Stacks after preflop SRP (UTG raises 2.5, BB calls 2.5)
  const preflopInvestment = 2.5;
  const remainingStack = cfg.stackDepthBB - preflopInvestment;
  const sbDeadMoney = 0.5;
  const pot = sbDeadMoney + preflopInvestment * 2; // 0.5 + 5 = 5.5

  const players: Player[] = [
    {
      position: 'UTG',
      stack: remainingStack,
      cards: villainCards as [Card, Card],
      isHero: cfg.villainPosition === 'UTG' && cfg.heroPosition === 'UTG',
      isActive: true,
      hasFolded: false,
      currentBet: 0,
    },
    { position: 'HJ', stack: cfg.stackDepthBB, isHero: false, isActive: false, hasFolded: true, currentBet: 0 },
    { position: 'CO', stack: cfg.stackDepthBB, isHero: false, isActive: false, hasFolded: true, currentBet: 0 },
    { position: 'BTN', stack: cfg.stackDepthBB, isHero: false, isActive: false, hasFolded: true, currentBet: 0 },
    { position: 'SB', stack: cfg.stackDepthBB - sbDeadMoney, isHero: false, isActive: false, hasFolded: true, currentBet: 0 },
    {
      position: 'BB',
      stack: remainingStack,
      cards: heroCards as [Card, Card],
      isHero: cfg.heroPosition === 'BB',
      isActive: true,
      hasFolded: false,
      currentBet: 0,
    },
  ];

  // Mark hero correctly
  for (const p of players) {
    p.isHero = p.position === cfg.heroPosition;
  }

  // Preflop history
  const preflopHistory: StreetHistory = {
    street: 'preflop',
    potBefore: 1.5,
    actions: [
      { position: 'UTG', type: 'raise', amount: 2.5, potAfter: 4, timestamp: new Date() },
      { position: 'HJ', type: 'fold', potAfter: 4, timestamp: new Date() },
      { position: 'CO', type: 'fold', potAfter: 4, timestamp: new Date() },
      { position: 'BTN', type: 'fold', potAfter: 4, timestamp: new Date() },
      { position: 'SB', type: 'fold', potAfter: 4, timestamp: new Date() },
      { position: 'BB', type: 'call', amount: 1.5, potAfter: 5.5, timestamp: new Date() },
    ],
  };

  const flopHistory: StreetHistory = {
    street: 'flop',
    cards: flopCards,
    potBefore: pot,
    actions: [],
  };

  return {
    id: `hand_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    phase: 'playing',
    config: cfg,
    players,
    communityCards: flopCards,
    deck,
    pot,
    currentStreet: 'flop',
    currentPosition: 'BB', // OOP acts first postflop
    effectiveStack: remainingStack,
    history: [preflopHistory, flopHistory],
    handNumber,
    currentBet: 0,
    lastRaiseSize: 0,
  };
}

/** Create an idle (empty) table */
export function createIdleTable(handNumber: number = 0, config?: TestConfig): GameState {
  const cfg: TestConfig = config ?? {
    heroPosition: 'BB',
    villainPosition: 'UTG',
    potType: 'SRP',
    stackDepthBB: 100,
  };

  const players: Player[] = [
    { position: 'UTG', stack: cfg.stackDepthBB, isHero: false, isActive: false, hasFolded: false, currentBet: 0 },
    { position: 'HJ', stack: cfg.stackDepthBB, isHero: false, isActive: false, hasFolded: false, currentBet: 0 },
    { position: 'CO', stack: cfg.stackDepthBB, isHero: false, isActive: false, hasFolded: false, currentBet: 0 },
    { position: 'BTN', stack: cfg.stackDepthBB, isHero: false, isActive: false, hasFolded: false, currentBet: 0 },
    { position: 'SB', stack: cfg.stackDepthBB, isHero: false, isActive: false, hasFolded: false, currentBet: 0 },
    { position: 'BB', stack: cfg.stackDepthBB, isHero: true, isActive: false, hasFolded: false, currentBet: 0 },
  ];

  for (const p of players) {
    p.isHero = p.position === cfg.heroPosition;
  }

  return {
    id: `table_idle_${Date.now()}`,
    phase: 'idle',
    config: cfg,
    players,
    communityCards: [],
    deck: [],
    pot: 0,
    currentStreet: 'preflop',
    currentPosition: null,
    effectiveStack: cfg.stackDepthBB,
    history: [],
    handNumber,
    currentBet: 0,
    lastRaiseSize: 0,
  };
}

// ─── Settlement ──────────────────────────────────────────────────────────────

export function resolveShowdown(gameState: GameState): ShowdownResult {
  const hero = gameState.players.find(p => p.isHero)!;
  const villain = gameState.players.find(p => !p.isHero && p.isActive && !p.hasFolded)!;

  if (!hero.cards || !villain.cards) {
    return {
      winnerId: null,
      heroHandRank: 'Unknown',
      villainHandRank: 'Unknown',
      potWon: 0,
      heroProfit: 0,
    };
  }

  const heroAll = [...hero.cards, ...gameState.communityCards];
  const villainAll = [...villain.cards, ...gameState.communityCards];

  const heroEval = evaluateHand(heroAll);
  const villainEval = evaluateHand(villainAll);
  const comparison = compareScores(heroEval.score, villainEval.score);

  // Calculate how much hero invested this hand
  const heroInvestment = (gameState.config.stackDepthBB - 2.5) - hero.stack + 0; // preflop 2.5 already deducted at start

  if (comparison > 0) {
    // Hero wins
    return {
      winnerId: hero.position,
      heroHandRank: heroEval.description,
      villainHandRank: villainEval.description,
      potWon: gameState.pot,
      heroProfit: gameState.pot - (gameState.config.stackDepthBB - 2.5 - hero.stack),
    };
  } else if (comparison < 0) {
    // Villain wins
    return {
      winnerId: villain.position,
      heroHandRank: heroEval.description,
      villainHandRank: villainEval.description,
      potWon: gameState.pot,
      heroProfit: -(gameState.config.stackDepthBB - 2.5 - hero.stack),
    };
  } else {
    // Split pot
    return {
      winnerId: null,
      heroHandRank: heroEval.description,
      villainHandRank: villainEval.description,
      potWon: gameState.pot,
      heroProfit: gameState.pot / 2 - (gameState.config.stackDepthBB - 2.5 - hero.stack),
    };
  }
}

// ─── Hand History ────────────────────────────────────────────────────────────

export function saveHandToHistory(
  handId: string,
  heroPosition: Position,
  heroCards: [Card, Card],
  opponentPosition: Position,
  board: Card[],
  pot: number,
  result: number,
  effectiveStack: number,
  history: StreetHistory[],
  username: string = 'default',
): void {
  const key = `poker_hand_history_${username}`;
  const stored = localStorage.getItem(key);
  const hands: HandRecord[] = stored ? JSON.parse(stored) : [];

  const handRecord: HandRecord = {
    id: handId,
    timestamp: new Date(),
    position: heroPosition,
    opponent: opponentPosition,
    holeCards: heroCards,
    board,
    finalPot: pot,
    result,
    effectiveStack,
    gameType: '6-max NLHE SRP',
    history,
  };

  hands.unshift(handRecord);
  if (hands.length > 1000) hands.splice(1000);
  localStorage.setItem(key, JSON.stringify(hands));
}
