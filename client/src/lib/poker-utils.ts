import type { Card, Suit, Rank, Position, GameState, Player, Street, StreetHistory, ActionType, TestConfig } from '@/types/poker';

export const SUIT_SYMBOLS: Record<Suit, string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
};

export const POSITIONS: Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

export function formatCard(card: Card): string {
  return `${card.rank}${SUIT_SYMBOLS[card.suit]}`;
}

export function getSuitColor(suit: Suit): 'red' | 'black' {
  return suit === 'hearts' || suit === 'diamonds' ? 'red' : 'black';
}

export function createDeck(): Card[] {
  const suits: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
  const ranks: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const deck: Card[] = [];
  for (const suit of suits) {
    for (const rank of ranks) {
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

export function dealCards(deck: Card[], count: number): [Card[], Card[]] {
  const dealt = deck.slice(0, count);
  const remaining = deck.slice(count);
  return [dealt, remaining];
}

export function getNextPosition(current: Position): Position {
  const index = POSITIONS.indexOf(current);
  return POSITIONS[(index + 1) % POSITIONS.length];
}

export function formatBB(amount: number): string {
  if (amount === 0) return '0 bb';
  if (Number.isInteger(amount)) return `${amount} bb`;
  return `${amount.toFixed(1)} bb`;
}

export function formatPotPercentage(betSize: number, pot: number): string {
  if (pot === 0) return '0%';
  const percentage = Math.round((betSize / pot) * 100);
  return `${percentage}%`;
}

export function generateHandId(): string {
  return `hand_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function getActionText(type: ActionType, amount?: number, pot?: number): string {
  switch (type) {
    case 'fold':
      return 'Fold';
    case 'check':
      return 'Check';
    case 'call':
      return amount ? `Call ${formatBB(amount)}` : 'Call';
    case 'bet':
      return amount && pot ? `Bet ${formatBB(amount)} (${formatPotPercentage(amount, pot)})` : 'Bet';
    case 'raise':
      return amount && pot ? `Raise ${formatBB(amount)} (${formatPotPercentage(amount, pot)})` : 'Raise';
    case 'allin':
      return amount ? `All-in ${formatBB(amount)}` : 'All-in';
    default:
      return type;
  }
}

/** Get a descriptive label for the current test scenario */
export function getScenarioLabel(config: TestConfig): string {
  const potLabel = config.potType === 'SRP' ? '单次加注底池' : config.potType;
  const effectiveStack = config.stackDepthBB - 2.5;
  return `${config.heroPosition} vs. ${config.villainPosition}, ${potLabel}, ${effectiveStack}bb`;
}
