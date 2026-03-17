import { useState } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Action, StreetHistory } from '@/types/poker';

interface ActionHistoryPopoverProps {
  history: StreetHistory[];
  isSingleView: boolean;
  showAIDecisionNotes?: boolean;
}

const DECISION_SOURCE_LABELS: Record<string, string> = {
  llm_river_exploit: 'LLM river exploit',
  gto_exact: 'GTO exact',
  gto_proxy_hand: 'GTO proxy hand',
  mdf_override: 'MDF override',
  fallback_default: 'Backend fallback',
  client_fallback_random: 'Client fallback',
};

function formatDecisionSource(source?: string): string | null {
  if (!source) return null;
  if (DECISION_SOURCE_LABELS[source]) return DECISION_SOURCE_LABELS[source];
  return source
    .split('_')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatActionText(action: Action): string {
  const position = action.position.toUpperCase();
  const actionType = action.type.toUpperCase();
  if (action.amount && action.amount > 0) {
    return `${position} ${actionType} ${action.amount.toFixed(1)}bb`;
  }
  return `${position} ${actionType}`;
}

function getActorLabel(action: Action): string {
  if (action.actor === 'hero') return 'YOU';
  if (action.actor === 'ai') return 'AI';
  return 'TABLE';
}

function getActorClasses(action: Action): string {
  if (action.actor === 'hero') {
    return 'border-[#00d084]/40 bg-[#00d084]/10 text-[#7af0b5]';
  }
  if (action.actor === 'ai') {
    return 'border-[#ff8c00]/40 bg-[#ff8c00]/10 text-[#ffbf66]';
  }
  return 'border-[#444444] bg-white/5 text-gray-400';
}

function getActionTextClasses(action: Action): string {
  if (action.actor === 'hero') return 'text-[#7af0b5]';
  if (action.actor === 'ai') return 'text-[#ffbf66]';
  return 'text-gray-300';
}

export function ActionHistoryPopover({
  history,
  isSingleView,
  showAIDecisionNotes = false,
}: ActionHistoryPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'rounded-full bg-white/10 hover:bg-white/20 transition-colors',
          isSingleView ? 'w-5 h-5' : 'w-4 h-4',
        )}
        title="View action history"
      >
        <Info className={cn('text-gray-400', isSingleView ? 'w-3 h-3' : 'w-2.5 h-2.5')} style={{ margin: 'auto' }} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />

          <div
            className={cn(
              'absolute z-50 bg-black/90 border border-[#333333] rounded-lg shadow-xl',
              isSingleView ? 'w-80 max-h-96 p-4 top-6 left-0' : 'w-72 max-h-72 p-3 top-5 left-0',
            )}
          >
            <div
              className={cn(
                'font-semibold mb-2 text-[#00d084]',
                isSingleView ? 'text-sm' : 'text-xs',
              )}
            >
              Action History
            </div>

            <div
              className={cn(
                'overflow-y-auto space-y-3',
                isSingleView ? 'max-h-80 text-xs' : 'max-h-60 text-[10px]',
              )}
            >
              {history.map((streetHistory, idx) => (
                <div key={idx}>
                  <div className="font-semibold text-gray-400 mb-1">{streetHistory.street.toUpperCase()}:</div>
                  <div className="space-y-1.5">
                    {streetHistory.actions.map((action, actionIdx) => {
                      const decisionLabel =
                        showAIDecisionNotes && action.actor === 'ai'
                          ? formatDecisionSource(action.decisionSource)
                          : null;

                      return (
                        <div
                          key={actionIdx}
                          className="rounded-md border border-white/5 bg-white/[0.03] px-2 py-1.5"
                        >
                          <div className="flex items-start gap-2">
                            <span
                              className={cn(
                                'inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                                getActorClasses(action),
                              )}
                            >
                              {getActorLabel(action)}
                            </span>
                            <div className="min-w-0">
                              <div className="text-gray-200 leading-relaxed">
                                <span className={cn('font-semibold', getActionTextClasses(action))}>
                                  {formatActionText(action)}
                                </span>
                                {decisionLabel && (
                                  <span
                                    className="text-gray-500"
                                    title={action.decisionDetail || decisionLabel}
                                  >
                                    {' · '}{decisionLabel}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {history.length === 0 && (
                <div className="text-gray-500 text-center py-4">
                  No action history yet
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
