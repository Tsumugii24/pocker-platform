import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Card, Suit, Rank, Position } from '@/types/poker';
import { PokerCard } from './PokerCard';
import { cn } from '@/lib/utils';
import { createDeck } from '@/lib/game-engine';

interface CustomHandDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (selectedCards: Card[]) => void;
    heroPosition: Position;
    villainPosition: Position;
    customHoleCards?: boolean;
}

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS: Rank[] = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];

export function CustomHandDialog({
    isOpen,
    onClose,
    onConfirm,
    heroPosition,
    villainPosition,
    customHoleCards = false,
}: CustomHandDialogProps) {
    const slotCount = customHoleCards ? 7 : 3;
    // If customHoleCards: 7 slots [Hero1, Hero2, Villain1, Villain2, Flop1, Flop2, Flop3]
    // If not customHoleCards: 3 slots [Flop1, Flop2, Flop3]
    const [slots, setSlots] = useState<(Card | null)[]>(Array(slotCount).fill(null));
    const [activeSlot, setActiveSlot] = useState<number>(0);

    useEffect(() => {
        if (isOpen) {
            setSlots(Array(slotCount).fill(null));
            setActiveSlot(0);
        }
    }, [isOpen, slotCount]);

    const handleCardClick = (card: Card) => {
        const isSelectedIdx = slots.findIndex(
            (c) => c && c.rank === card.rank && c.suit === card.suit
        );

        if (isSelectedIdx !== -1) {
            // Toggle off if already selected
            const newSlots = [...slots];
            newSlots[isSelectedIdx] = null;
            setSlots(newSlots);
            setActiveSlot(isSelectedIdx); // set the removed slot as active to make it easy to pick a new one
            return;
        }

        // Set the card in the active slot
        if (activeSlot !== -1 && activeSlot < slotCount) {
            const newSlots = [...slots];
            newSlots[activeSlot] = card;
            setSlots(newSlots);

            // Advance active slot to the next empty one
            const nextEmpty = newSlots.findIndex((c) => c === null);
            if (nextEmpty !== -1) {
                setActiveSlot(nextEmpty);
            }
        }
    };

    const handleConfirm = () => {
        if (slots.every((c) => c !== null)) {
            onConfirm(slots as Card[]);
            onClose();
        }
    };

    const isComplete = slots.every((c) => c !== null);

    const renderSlotGroup = (label: string, startIndex: number, count: number) => {
        return (
            <div className="flex flex-col items-center gap-2">
                <span className="text-xs text-gray-400 font-medium">{label}</span>
                <div className="flex gap-2">
                    {Array.from({ length: count }).map((_, i) => {
                        const idx = startIndex + i;
                        const card = slots[idx];
                        const isActive = activeSlot === idx;
                        return (
                            <div
                                key={idx}
                                onClick={() => setActiveSlot(idx)}
                                className={cn(
                                    "w-12 h-16 rounded-md border-2 cursor-pointer flex items-center justify-center bg-[#1a1a1a] transition-all",
                                    isActive ? "border-[#00d084] shadow-[0_0_10px_rgba(0,208,132,0.3)]" : "border-[#333333] hover:border-gray-500",
                                    card && "border-transparent bg-transparent"
                                )}
                            >
                                {card ? (
                                    <PokerCard card={card} size="small" />
                                ) : (
                                    <span className="text-gray-600 text-[10px]">Pick</span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-[#0a0a0a] border-[#333333] text-white w-full max-w-[95vw] sm:max-w-[850px]">
                <DialogHeader>
                    <DialogTitle className="text-xl font-bold">自定义手牌设置</DialogTitle>
                </DialogHeader>

                <div className="py-4 space-y-8">
                    {/* Selected Cards Area */}
                    <div className="flex justify-center gap-8 p-4 bg-[#111] rounded-lg border border-[#222]">
                        {customHoleCards && (
                            <>
                                {renderSlotGroup(`Hero (${heroPosition})`, 0, 2)}
                                <div className="w-px bg-[#333333]" />
                                {renderSlotGroup(`Villain (${villainPosition})`, 2, 2)}
                                <div className="w-px bg-[#333333]" />
                            </>
                        )}
                        {renderSlotGroup("Flop", customHoleCards ? 4 : 0, 3)}
                    </div>

                    {/* Deck Picker */}
                    <div className="space-y-2">
                        <h3 className="text-sm font-medium text-gray-400 mb-4 text-center">
                            选择一张牌 (剩余: {52 - slots.filter(Boolean).length})
                        </h3>
                        <div className="grid grid-rows-4 gap-1.5 justify-center">
                            {SUITS.map((suit) => (
                                <div key={suit} className="flex gap-1.5">
                                    {RANKS.map((rank) => {
                                        const card = { suit, rank };
                                        const isSelected = slots.some(
                                            (c) => c && c.rank === rank && c.suit === suit
                                        );
                                        return (
                                            <div
                                                key={rank}
                                                onClick={() => handleCardClick(card)}
                                                className={cn(
                                                    "transition-transform hover:scale-105 cursor-pointer",
                                                    isSelected && "opacity-20 cursor-not-allowed transform-none"
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

                <DialogFooter className="border-t border-[#333333] pt-4 flex items-center justify-between">
                    <Button
                        onClick={() => {
                            setSlots(Array(slotCount).fill(null));
                            setActiveSlot(0);
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
                            className="border-[#333333] hover:bg-white/5 text-white"
                        >
                            取消
                        </Button>
                        <Button
                            onClick={handleConfirm}
                            disabled={!isComplete}
                            className={cn(
                                "font-semibold text-black",
                                isComplete ? "bg-[#00d084] hover:bg-[#00d084]/90" : "bg-gray-600 text-gray-400"
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
