import type { Card } from '@/types/poker';
import { formatCard, getSuitColor, SUIT_SYMBOLS } from '@/lib/poker-utils';
import { cn } from '@/lib/utils';

interface PokerCardProps {
  card: Card;
  size?: 'small' | 'medium' | 'large';
  className?: string;
}

export function PokerCard({ card, size = 'medium', className }: PokerCardProps) {
  const suitColor = getSuitColor(card.suit);
  
  const sizeClasses = {
    small: 'w-[30px] h-[42px] text-xs',
    medium: 'w-[60px] h-[84px] text-2xl',
    large: 'w-[80px] h-[112px] text-3xl',
  };
  
  return (
    <div
      className={cn(
        'poker-card',
        sizeClasses[size],
        suitColor === 'red' ? 'text-red-600' : 'text-black',
        className
      )}
    >
      <div className="flex flex-col items-center justify-center h-full">
        <div className="font-bold leading-none">{card.rank}</div>
        <div className="text-xl leading-none">{SUIT_SYMBOLS[card.suit]}</div>
      </div>
    </div>
  );
}

interface WaitingCardProps {
  size?: 'small' | 'medium' | 'large';
  className?: string;
}

export function WaitingCard({ size = 'medium', className }: WaitingCardProps) {
  const sizeClasses = {
    small: 'w-[30px] h-[42px] text-xs',
    medium: 'w-[60px] h-[84px] text-xl',
    large: 'w-[80px] h-[112px] text-2xl',
  };
  
  return (
    <div
      className={cn(
        'rounded-lg bg-gray-700 flex items-center justify-center font-semibold text-gray-400',
        sizeClasses[size],
        className
      )}
    >
      W
    </div>
  );
}
