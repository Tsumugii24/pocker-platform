import type { Player } from '@/types/poker';
import { cn } from '@/lib/utils';
import { formatBB } from '@/lib/poker-utils';

interface PlayerPositionProps {
  player: Player;
  size?: 'small' | 'medium';
  className?: string;
}

export function PlayerPosition({ player, size = 'medium', className }: PlayerPositionProps) {
  const sizeClasses = {
    small: 'w-10 h-10 text-xs',
    medium: 'w-16 h-16 text-base',
  };
  
  const borderColor = player.isHero
    ? 'border-[#00d084]'
    : player.isActive
    ? 'border-[#ff8c00]'
    : 'border-[#333333]';
  
  const textColor = player.isHero
    ? 'text-[#00d084]'
    : player.hasFolded
    ? 'text-gray-600'
    : 'text-white';
  
  return (
    <div className={cn('flex flex-col items-center gap-1', className)}>
      <div
        className={cn(
          'poker-position-circle',
          sizeClasses[size],
          borderColor,
          'bg-transparent'
        )}
      >
        <span className={cn('font-semibold', textColor)}>
          {player.position}
        </span>
      </div>
      <span className={cn('text-xs', textColor)}>
        {player.stack}
      </span>
    </div>
  );
}
