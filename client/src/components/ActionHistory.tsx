import type { StreetHistory, Street } from '@/types/poker';
import { PokerCard } from './PokerCard';
import { getActionText, formatBB } from '@/lib/poker-utils';
import { cn } from '@/lib/utils';
import { ChevronLeft } from 'lucide-react';

interface ActionHistoryProps {
  history: StreetHistory[];
  currentStreet: Street;
  isOpen: boolean;
  onToggle: () => void;
}

export function ActionHistory({ history, currentStreet, isOpen, onToggle }: ActionHistoryProps) {
  if (!isOpen) {
    return null;
  }
  
  const streetOrder: Street[] = ['preflop', 'flop', 'turn', 'river'];
  const currentIndex = streetOrder.indexOf(currentStreet);
  
  return (
    <div className="w-[30%] border-l border-[#333333] bg-[#0a0a0a] flex flex-col">
      {/* Header */}
      <div className="h-12 border-b border-[#333333] flex items-center justify-between px-4">
        <h3 className="text-sm font-semibold">ACTION HISTORY</h3>
        <button
          onClick={onToggle}
          className="p-1 hover:bg-white/5 rounded transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>
      
      {/* Timeline */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {streetOrder.map((street, index) => {
          const streetData = history.find(h => h.street === street);
          const isCurrent = street === currentStreet;
          const isPast = index < currentIndex;
          const isFuture = index > currentIndex;
          
          return (
            <div
              key={street}
              className={cn(
                'pb-4',
                isCurrent && 'border-l-2 border-[#00d084] pl-3 -ml-[2px]',
                isFuture && 'opacity-50'
              )}
            >
              {/* Street Title */}
              <div className="flex items-center justify-between mb-2">
                <h4 className={cn(
                  'text-xs font-semibold uppercase tracking-wide',
                  isCurrent ? 'text-[#00d084]' : isFuture ? 'text-gray-600' : 'text-[#00d084]'
                )}>
                  {street}
                </h4>
                {streetData && (
                  <span className="text-xs text-gray-400">
                    {formatBB(streetData.potBefore)}
                  </span>
                )}
              </div>
              
              <div className={cn(
                'h-px mb-3',
                isCurrent ? 'bg-[#00d084]' : 'bg-[#333333]'
              )} />
              
              {/* Cards */}
              {streetData?.cards && streetData.cards.length > 0 && (
                <div className="flex gap-1 mb-3">
                  {streetData.cards.map((card, i) => (
                    <PokerCard
                      key={i}
                      card={card}
                      size="small"
                      className={cn(isCurrent && i === streetData.cards!.length - 1 && 'ring-1 ring-[#00d084]')}
                    />
                  ))}
                </div>
              )}
              
              {/* Actions */}
              {streetData && streetData.actions.length > 0 ? (
                <div className="space-y-2">
                  {streetData.actions.map((action, i) => (
                    <div key={i} className="text-sm">
                      <div className="text-white">
                        <span className="font-semibold">{action.position}:</span>{' '}
                        {getActionText(action.type, action.amount, streetData.potBefore)}
                      </div>
                      {action.amount && (
                        <div className="text-xs text-gray-500 ml-4">
                          pot {formatBB(action.potAfter)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : isCurrent ? (
                <div className="text-sm text-gray-500 italic">
                  <span className="text-gray-400">{streetData?.actions[0]?.position || 'UTG'}:</span> ...
                </div>
              ) : isFuture ? (
                <div className="text-sm text-gray-600 italic">
                  Not reached
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface CollapsedActionHistoryProps {
  currentStreet: Street;
  onExpand: () => void;
}

export function CollapsedActionHistory({ currentStreet, onExpand }: CollapsedActionHistoryProps) {
  const streets: { key: Street; label: string }[] = [
    { key: 'preflop', label: 'PRE' },
    { key: 'flop', label: 'FLP' },
    { key: 'turn', label: 'TRN' },
    { key: 'river', label: 'RIV' },
  ];
  
  const currentIndex = streets.findIndex(s => s.key === currentStreet);
  
  return (
    <div className="absolute top-4 right-4 bg-[#1a1a1a] border border-[#333333] rounded-lg p-2 flex items-center gap-2">
      {streets.map((street, index) => {
        const isPast = index < currentIndex;
        const isCurrent = index === currentIndex;
        const isFuture = index > currentIndex;
        
        return (
          <div
            key={street.key}
            className={cn(
              'w-10 h-8 rounded flex items-center justify-center text-xs font-semibold border-2 transition-colors',
              isCurrent && 'border-[#00d084] text-[#00d084]',
              isPast && 'border-gray-600 text-gray-600',
              isFuture && 'border-[#333333] text-[#333333]'
            )}
          >
            {street.label}
          </div>
        );
      })}
      
      <button
        onClick={onExpand}
        className="ml-1 p-1 hover:bg-white/5 rounded transition-colors"
      >
        <ChevronLeft className="w-4 h-4 rotate-180" />
      </button>
    </div>
  );
}
