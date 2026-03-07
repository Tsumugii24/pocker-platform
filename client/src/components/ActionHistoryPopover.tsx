import { useState } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StreetHistory } from '@/types/poker';

interface ActionHistoryPopoverProps {
  history: StreetHistory[];
  isSingleView: boolean;
}

export function ActionHistoryPopover({ history, isSingleView }: ActionHistoryPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  const formatAction = (action: any) => {
    const pos = action.position.toUpperCase();
    const act = action.type.toUpperCase();
    if (action.amount && action.amount > 0) {
      return `${pos} ${act} ${action.amount.toFixed(1)}bb`;
    }
    return `${pos} ${act}`;
  };
  
  return (
    <div className="relative inline-block">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'rounded-full bg-white/10 hover:bg-white/20 transition-colors',
          isSingleView ? 'w-5 h-5' : 'w-4 h-4'
        )}
        title="查看行动历史"
      >
        <Info className={cn('text-gray-400', isSingleView ? 'w-3 h-3' : 'w-2.5 h-2.5')} style={{ margin: 'auto' }} />
      </button>
      
      {isOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setIsOpen(false)}
          />
          
          {/* Popover */}
          <div className={cn(
            'absolute z-50 bg-black/90 border border-[#333333] rounded-lg shadow-xl',
            isSingleView ? 'w-80 max-h-96 p-4 top-6 left-0' : 'w-64 max-h-64 p-3 top-5 left-0'
          )}>
            <div className={cn(
              'font-semibold mb-2 text-[#00d084]',
              isSingleView ? 'text-sm' : 'text-xs'
            )}>
              行动历史
            </div>
            
            <div className={cn(
              'overflow-y-auto space-y-2',
              isSingleView ? 'max-h-80 text-xs' : 'max-h-52 text-[10px]'
            )}>
              {history.map((streetHistory, idx) => (
                <div key={idx}>
                  <div className="font-semibold text-gray-400 mb-1">{streetHistory.street.toUpperCase()}:</div>
                  <div className="space-y-0.5 text-gray-300">
                    {streetHistory.actions.map((action, actionIdx) => (
                      <div key={actionIdx}>{formatAction(action)}</div>
                    ))}
                  </div>
                </div>
              ))}
              
              {history.length === 0 && (
                <div className="text-gray-500 text-center py-4">
                  暂无行动历史
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
