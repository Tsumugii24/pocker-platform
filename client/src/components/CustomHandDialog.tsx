import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import type { Card, Position, Rank, Suit } from '@/types/poker';
import { PokerCard } from './PokerCard';
import { cn } from '@/lib/utils';
import { FRONTEND_CUSTOM_HAND_CONFIG } from '@/config/frontend-config';

interface CustomHandDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (selectedCards: Card[]) => void;
  heroPosition: Position;
  villainPosition: Position;
  customHoleCards?: boolean;
  datasetSource?: 'huggingface' | 'hf-mirror';
}

interface FlopIsomorphismStatus {
  actualFlop: string;
  canonicalFlop: string;
  cached: boolean;
  error?: string | null;
}

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS: Rank[] = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const SUIT_SYMBOL_TO_NAME: Record<string, Suit> = {
  s: 'spades',
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
};

const SUIT_PERMUTATIONS: Suit[][] = [
  ['spades', 'hearts', 'diamonds', 'clubs'],
  ['spades', 'hearts', 'clubs', 'diamonds'],
  ['spades', 'diamonds', 'hearts', 'clubs'],
  ['spades', 'diamonds', 'clubs', 'hearts'],
  ['spades', 'clubs', 'hearts', 'diamonds'],
  ['spades', 'clubs', 'diamonds', 'hearts'],
  ['hearts', 'spades', 'diamonds', 'clubs'],
  ['hearts', 'spades', 'clubs', 'diamonds'],
  ['hearts', 'diamonds', 'spades', 'clubs'],
  ['hearts', 'diamonds', 'clubs', 'spades'],
  ['hearts', 'clubs', 'spades', 'diamonds'],
  ['hearts', 'clubs', 'diamonds', 'spades'],
  ['diamonds', 'spades', 'hearts', 'clubs'],
  ['diamonds', 'spades', 'clubs', 'hearts'],
  ['diamonds', 'hearts', 'spades', 'clubs'],
  ['diamonds', 'hearts', 'clubs', 'spades'],
  ['diamonds', 'clubs', 'spades', 'hearts'],
  ['diamonds', 'clubs', 'hearts', 'spades'],
  ['clubs', 'spades', 'hearts', 'diamonds'],
  ['clubs', 'spades', 'diamonds', 'hearts'],
  ['clubs', 'hearts', 'spades', 'diamonds'],
  ['clubs', 'hearts', 'diamonds', 'spades'],
  ['clubs', 'diamonds', 'spades', 'hearts'],
  ['clubs', 'diamonds', 'hearts', 'spades'],
];

export function CustomHandDialog({
  isOpen,
  onClose,
  onConfirm,
  heroPosition,
  villainPosition,
  customHoleCards = false,
}: CustomHandDialogProps) {
  const slotCount = customHoleCards
    ? FRONTEND_CUSTOM_HAND_CONFIG.boardAndHoleCardSlotCount
    : FRONTEND_CUSTOM_HAND_CONFIG.boardOnlySlotCount;
  const flopStart = customHoleCards ? 4 : 0;

  const [slots, setSlots] = useState<(Card | null)[]>(Array(slotCount).fill(null));
  const [activeSlot, setActiveSlot] = useState<number>(0);
  const [cachedBoards, setCachedBoards] = useState<string[]>([]);
  const [flopStatus, setFlopStatus] = useState<FlopIsomorphismStatus | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;
    setSlots(Array(slotCount).fill(null));
    setActiveSlot(0);
    setFlopStatus(null);

    if (cachedBoards.length === 0) {
      fetch('/api/cached-boards')
        .then(res => res.json())
        .then(data => {
          if (!cancelled) {
            setCachedBoards(Array.isArray(data.boards) ? data.boards : []);
          }
        })
        .catch(error => {
          if (!cancelled) {
            console.error(error);
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [cachedBoards.length, isOpen, slotCount]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const flopCards = slots.slice(flopStart, flopStart + 3);
    if (flopCards.some(card => card === null)) {
      setFlopStatus(null);
      return;
    }

    const board = (flopCards as Card[])
      .map(card => `${card.rank}${card.suit[0]}`)
      .join(',');
    const controller = new AbortController();

    fetch('/api/flop-isomorphism', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board }),
      signal: controller.signal,
    })
      .then(async res => {
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload?.error || `HTTP ${res.status}`);
        }
        setFlopStatus({
          actualFlop: String(payload.actualFlop || '').trim(),
          canonicalFlop: String(payload.canonicalFlop || '').trim(),
          cached: Boolean(payload.cached),
          error: null,
        });
      })
      .catch(error => {
        if (controller.signal.aborted) {
          return;
        }
        setFlopStatus({
          actualFlop: board.replaceAll(',', ''),
          canonicalFlop: '',
          cached: false,
          error: error instanceof Error ? error.message : 'Failed to check flop mapping.',
        });
      });

    return () => controller.abort();
  }, [flopStart, isOpen, slots]);

  const handleCardClick = (card: Card) => {
    const isSelectedIdx = slots.findIndex(
      selected => selected && selected.rank === card.rank && selected.suit === card.suit,
    );

    if (isSelectedIdx !== -1) {
      const newSlots = [...slots];
      newSlots[isSelectedIdx] = null;
      setSlots(newSlots);
      setActiveSlot(isSelectedIdx);
      return;
    }

    if (activeSlot !== -1 && activeSlot < slotCount) {
      const newSlots = [...slots];
      newSlots[activeSlot] = card;
      setSlots(newSlots);

      const nextEmpty = newSlots.findIndex(selected => selected === null);
      if (nextEmpty !== -1) {
        setActiveSlot(nextEmpty);
      }
    }
  };

  const handleConfirm = () => {
    if (slots.every(card => card !== null)) {
      onConfirm(slots as Card[]);
      onClose();
    }
  };

  const isComplete = slots.every(card => card !== null);

  const renderSlotGroup = (label: string, startIndex: number, count: number) => (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs font-medium text-gray-400">{label}</span>
      <div className="flex gap-2">
        {Array.from({ length: count }).map((_, offset) => {
          const idx = startIndex + offset;
          const card = slots[idx];
          const isActive = activeSlot === idx;
          return (
            <div
              key={idx}
              onClick={() => {
                if (card) {
                  const newSlots = [...slots];
                  newSlots[idx] = null;
                  setSlots(newSlots);
                  setActiveSlot(idx);
                } else {
                  setActiveSlot(idx);
                }
              }}
              className={cn(
                'flex h-16 w-12 cursor-pointer items-center justify-center rounded-md border-2 bg-[#1a1a1a] transition-all',
                isActive
                  ? 'border-[#00d084] shadow-[0_0_10px_rgba(0,208,132,0.3)]'
                  : 'border-[#333333] hover:border-gray-500',
                card && 'border-transparent bg-transparent',
              )}
            >
              {card ? (
                <PokerCard card={card} size="small" />
              ) : (
                <span className="text-[10px] text-gray-600">Pick</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const applyBoard = (boardStr: string) => {
    const parseBoardCard = (index: number): Card => {
      const rank = boardStr[index * 2] as Rank;
      const suitSymbol = boardStr[index * 2 + 1];
      return {
        rank,
        suit: SUIT_SYMBOL_TO_NAME[suitSymbol] || 'spades',
      };
    };

    const newSlots = [...slots];
    const newFlop = [parseBoardCard(0), parseBoardCard(1), parseBoardCard(2)];

    for (let index = 0; index < slotCount; index += 1) {
      if (index >= flopStart && index < flopStart + 3) {
        continue;
      }
      const existing = newSlots[index];
      if (
        existing &&
        newFlop.some(card => card.rank === existing.rank && card.suit === existing.suit)
      ) {
        newSlots[index] = null;
      }
    }

    newSlots[flopStart] = newFlop[0];
    newSlots[flopStart + 1] = newFlop[1];
    newSlots[flopStart + 2] = newFlop[2];

    setSlots(newSlots);
    const nextEmpty = newSlots.findIndex(card => card === null);
    setActiveSlot(nextEmpty !== -1 ? nextEmpty : slotCount);
  };

  const handleRandomCachedBoard = () => {
    if (cachedBoards.length === 0) {
      return;
    }
    const randomIndex = Math.floor(Math.random() * cachedBoards.length);
    applyBoard(cachedBoards[randomIndex]);
  };

  const handleRandomIsomorphicTransform = () => {
    const hasCards = slots.some(card => card !== null);
    if (!hasCards) {
      return;
    }

    const nonIdentityPermutations = SUIT_PERMUTATIONS.filter(
      permutation => permutation.some((suit, index) => suit !== SUITS[index]),
    );
    const permutationPool = nonIdentityPermutations.length > 0 ? nonIdentityPermutations : SUIT_PERMUTATIONS;
    const permutation = permutationPool[Math.floor(Math.random() * permutationPool.length)];
    const suitMap = new Map<Suit, Suit>(SUITS.map((suit, index) => [suit, permutation[index]]));

    setSlots(previous =>
      previous.map(card => (
        card
          ? {
              ...card,
              suit: suitMap.get(card.suit) ?? card.suit,
            }
          : null
      )),
    );
  };

  const statusMessage = (() => {
    if (!flopStatus) {
      return null;
    }
    if (flopStatus.error) {
      return {
        tone: 'error' as const,
        text: `Mapping check failed: ${flopStatus.error}`,
      };
    }
    if (flopStatus.cached) {
      return {
        tone: 'success' as const,
        text: `Current flop maps to canonical flop ${flopStatus.canonicalFlop} and hits local cached strategy.`,
      };
    }
    return {
      tone: 'error' as const,
      text: `Current flop maps to canonical flop ${flopStatus.canonicalFlop}, but that canonical board is not in local cache.`,
    };
  })();

  const canApplyIsomorphicTransform = slots.some(card => card !== null);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-full max-w-[95vw] border-[#333333] bg-[#0a0a0a] text-white sm:max-w-[850px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Custom Hand Setup</DialogTitle>
        </DialogHeader>

        <div className="space-y-8 py-4">
          <div className="flex flex-col items-center gap-4">
            <div className="flex justify-center gap-8 rounded-lg border border-[#222] bg-[#111] p-4">
              {customHoleCards && (
                <>
                  {renderSlotGroup(`Hero (${heroPosition})`, 0, 2)}
                  <div className="w-px bg-[#333333]" />
                  {renderSlotGroup(`Villain (${villainPosition})`, 2, 2)}
                  <div className="w-px bg-[#333333]" />
                </>
              )}
              {renderSlotGroup('Flop', flopStart, 3)}
            </div>

            {statusMessage && (
              <div
                className={cn(
                  'flex w-full max-w-xl items-center justify-center rounded-md border px-4 py-2 text-center text-sm font-semibold',
                  statusMessage.tone === 'success'
                    ? 'border-[#00d084]/20 bg-[#00d084]/10 text-[#00d084]'
                    : 'border-red-500/20 bg-red-500/10 text-red-400',
                )}
              >
                {statusMessage.text}
              </div>
            )}

            <div className="flex gap-4">
              <Button
                variant="outline"
                className="h-8 border-[#333333] bg-[#1a1a1a] py-1 text-xs text-gray-300 hover:bg-[#333333] hover:text-white"
                onClick={handleRandomCachedBoard}
                disabled={cachedBoards.length === 0}
              >
                {cachedBoards.length === 0
                  ? 'No Cache Found'
                  : `Random Cached Solved Strategy (${cachedBoards.length})`}
              </Button>
              <Button
                variant="outline"
                className="h-8 border-[#333333] bg-[#1a1a1a] py-1 text-xs text-gray-300 hover:bg-[#333333] hover:text-white"
                onClick={handleRandomIsomorphicTransform}
                disabled={!canApplyIsomorphicTransform}
              >
                Random Suit-Isomorphic Transform
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="mb-4 text-center text-sm font-medium tabular-nums text-gray-400">
              Pick Cards (remaining: {52 - slots.filter(Boolean).length})
            </h3>
            <div className="grid justify-center gap-1.5">
              {SUITS.map(suit => (
                <div key={suit} className="flex gap-1.5">
                  {RANKS.map(rank => {
                    const card = { suit, rank };
                    const isSelected = slots.some(
                      selected => selected && selected.rank === rank && selected.suit === suit,
                    );
                    return (
                      <div
                        key={`${rank}-${suit}`}
                        onClick={() => handleCardClick(card)}
                        className={cn(
                          'cursor-pointer transition-transform hover:scale-105',
                          isSelected && 'cursor-not-allowed opacity-20 transform-none',
                        )}
                      >
                        <PokerCard card={card} size="small" />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between border-t border-[#333333] pt-4">
          <Button
            onClick={() => {
              setSlots(Array(slotCount).fill(null));
              setActiveSlot(0);
              setFlopStatus(null);
            }}
            variant="ghost"
            className="text-gray-400 hover:text-white"
          >
            Clear All
          </Button>
          <div className="flex gap-2">
            <Button
              onClick={onClose}
              variant="outline"
              className="border-[#333333] text-white hover:bg-white/5"
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!isComplete}
              className={cn(
                'min-w-[140px] font-semibold tabular-nums text-black',
                isComplete ? 'bg-[#00d084] hover:bg-[#00d084]/90' : 'bg-gray-600 text-gray-400',
              )}
            >
              Start Game ({slots.filter(Boolean).length}/{slotCount})
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
