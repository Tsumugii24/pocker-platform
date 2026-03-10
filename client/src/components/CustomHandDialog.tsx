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
    datasetSource?: 'huggingface' | 'hf-mirror';
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
    datasetSource,
}: CustomHandDialogProps) {
    const slotCount = customHoleCards ? 7 : 3;
    // If customHoleCards: 7 slots [Hero1, Hero2, Villain1, Villain2, Flop1, Flop2, Flop3]
    // If not customHoleCards: 3 slots [Flop1, Flop2, Flop3]
    const [slots, setSlots] = useState<(Card | null)[]>(Array(slotCount).fill(null));
    const [activeSlot, setActiveSlot] = useState<number>(0);
    const [solvedBoards, setSolvedBoards] = useState<string[]>([]);

    useEffect(() => {
        if (isOpen) {
            setSlots(Array(slotCount).fill(null));
            setActiveSlot(0);

            if (solvedBoards.length === 0) {
                const url = datasetSource ? `/api/solved-boards?source=${datasetSource}` : '/api/solved-boards';
                fetch(url)
                    .then(res => res.json())
                    .then(data => {
                        if (data.boards) setSolvedBoards(data.boards);
                    })
                    .catch(console.error);
            }
        }
    }, [isOpen, slotCount, solvedBoards.length]);

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

    const getFlopPermutations = (f1: Card, f2: Card, f3: Card) => {
        const s1 = f1.rank + f1.suit[0];
        const s2 = f2.rank + f2.suit[0];
        const s3 = f3.rank + f3.suit[0];
        return [
            s1 + s2 + s3,
            s1 + s3 + s2,
            s2 + s1 + s3,
            s2 + s3 + s1,
            s3 + s1 + s2,
            s3 + s2 + s1
        ];
    };

    const isCurrentFlopSolved = () => {
        const flopStart = customHoleCards ? 4 : 0;
        const f1 = slots[flopStart];
        const f2 = slots[flopStart + 1];
        const f3 = slots[flopStart + 2];
        if (!f1 || !f2 || !f3) return null;
        if (solvedBoards.length === 0) return null;

        const perms = getFlopPermutations(f1, f2, f3);
        const solvedSet = new Set(solvedBoards);
        return perms.some(p => solvedSet.has(p));
    };

    const handleRandomSolvedBoard = () => {
        if (solvedBoards.length === 0) return;
        const rIndex = Math.floor(Math.random() * solvedBoards.length);
        const boardStr = solvedBoards[rIndex];

        const parseBoardCard = (idx: number): Card => {
            const r = boardStr[idx * 2] as Rank;
            const sChar = boardStr[idx * 2 + 1];
            const suitMap: Record<string, Suit> = { 's': 'spades', 'h': 'hearts', 'd': 'diamonds', 'c': 'clubs' };
            return { rank: r, suit: suitMap[sChar] || 'spades' };
        };

        const newSlots = [...slots];
        const flopStart = customHoleCards ? 4 : 0;
        const newFlop = [parseBoardCard(0), parseBoardCard(1), parseBoardCard(2)];

        for (let i = 0; i < slotCount; i++) {
            if (i >= flopStart && i < flopStart + 3) continue;
            const existing = newSlots[i];
            if (existing && newFlop.some(nf => nf.rank === existing.rank && nf.suit === existing.suit)) {
                newSlots[i] = null;
            }
        }

        newSlots[flopStart] = newFlop[0];
        newSlots[flopStart + 1] = newFlop[1];
        newSlots[flopStart + 2] = newFlop[2];

        setSlots(newSlots);
        const nextEmpty = newSlots.findIndex((c) => c === null);
        setActiveSlot(nextEmpty !== -1 ? nextEmpty : slotCount);
    };

    const solvedStatus = isCurrentFlopSolved();

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-[#0a0a0a] border-[#333333] text-white w-full max-w-[95vw] sm:max-w-[850px]">
                <DialogHeader>
                    <DialogTitle className="text-xl font-bold">自定义手牌设置</DialogTitle>
                </DialogHeader>

                <div className="py-4 space-y-8">
                    <div className="flex flex-col items-center gap-4">
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

                        {solvedStatus !== null && (
                            <div className={cn(
                                "flex items-center justify-center px-4 py-2 rounded-md border text-sm font-semibold max-w-sm w-full",
                                solvedStatus
                                    ? "bg-[#00d084]/10 border-[#00d084]/20 text-[#00d084]"
                                    : "bg-red-500/10 border-red-500/20 text-red-500"
                            )}>
                                {solvedStatus
                                    ? "✅ 牌面已解算"
                                    : "❌ 暂未解算 (AI会使用默认的随机策略)"}
                            </div>
                        )}

                        <Button
                            variant="outline"
                            className="bg-[#1a1a1a] border-[#333333] hover:bg-[#333333] hover:text-white text-gray-300 text-xs py-1 h-8"
                            onClick={handleRandomSolvedBoard}
                            disabled={solvedBoards.length === 0}
                        >
                            {solvedBoards.length === 0 ? "Loading Solved Boards..." : "🎲 随机选取一个已解算的 Flop"}
                        </Button>
                    </div>

                    {/* Deck Picker */}
                    <div className="space-y-2">
                        <h3 className="text-sm font-medium text-gray-400 mb-4 text-center tabular-nums">
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
                                "font-semibold text-black tabular-nums min-w-[140px]",
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
