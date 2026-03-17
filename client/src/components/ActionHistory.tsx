import { useEffect, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, History } from 'lucide-react';
import type { Action, GamePhase, StreetHistory, Street } from '@/types/poker';
import { PokerCard } from './PokerCard';
import { formatBB, getActionText } from '@/lib/poker-utils';
import { cn } from '@/lib/utils';
import { FRONTEND_SIDEBAR_CONFIG } from '@/config/frontend-config';

interface ActionHistoryProps {
  handId: string;
  history: StreetHistory[];
  currentStreet: Street;
  phase: GamePhase;
  isOpen: boolean;
  onToggle: () => void;
  showAIDecisionNotes?: boolean;
}

type ActionHistoryView = Street | 'all';

const STREET_OPTIONS: { key: ActionHistoryView; label: string }[] = [
  { key: 'preflop', label: 'PRE' },
  { key: 'flop', label: 'FLP' },
  { key: 'turn', label: 'TRN' },
  { key: 'river', label: 'RIV' },
  { key: 'all', label: 'ALL' },
];

const DEFAULT_ALL_SECTION_COLLAPSE: Record<Street, boolean> = {
  preflop: true,
  flop: false,
  turn: false,
  river: false,
};

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

function getActorLabel(action: Action): string {
  if (action.actor === 'hero') return 'YOU';
  if (action.actor === 'ai') return 'AI';
  return 'TABLE';
}

function getActorBadgeClasses(action: Action): string {
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
  return 'text-gray-200';
}

function getDefaultView(phase: GamePhase, currentStreet: Street): ActionHistoryView {
  return phase === 'showdown' ? 'all' : currentStreet;
}

interface StreetTabsProps {
  selectedView: ActionHistoryView;
  currentStreet: Street;
  onSelect: (view: ActionHistoryView) => void;
  compact?: boolean;
}

function StreetTabs({ selectedView, currentStreet, onSelect, compact = false }: StreetTabsProps) {
  return (
    <div className={cn('flex flex-wrap gap-2', compact && 'flex-col items-center')}>
      {STREET_OPTIONS.map(option => {
        const isSelected = option.key === selectedView;
        const isCurrentStreet = option.key === currentStreet;

        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onSelect(option.key)}
            className={cn(
              'flex items-center justify-center rounded-md border text-[10px] font-semibold tracking-wide transition-colors',
              compact ? 'h-8 w-10' : 'h-9 min-w-[44px] px-3',
              isSelected
                ? 'border-[#00d084] bg-[#00d084]/10 text-[#00d084]'
                : isCurrentStreet
                  ? 'border-[#2f6d56] bg-[#00d084]/[0.04] text-[#5bcf9d]'
                  : 'border-[#333333] text-gray-500 hover:border-[#4a4a4a] hover:text-gray-300',
            )}
            title={
              option.key === 'all'
                ? 'Show every street'
                : `Show ${option.label.toLowerCase()} actions`
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface StreetSectionProps {
  street: Street;
  streetData?: StreetHistory;
  isCurrent: boolean;
  isFuture: boolean;
  isCollapsed: boolean;
  isCollapsible: boolean;
  onToggleCollapse?: () => void;
  showAIDecisionNotes: boolean;
}

function StreetSection({
  street,
  streetData,
  isCurrent,
  isFuture,
  isCollapsed,
  isCollapsible,
  onToggleCollapse,
  showAIDecisionNotes,
}: StreetSectionProps) {
  return (
    <section
      className={cn(
        'rounded-xl border border-[#202020] bg-white/[0.03] p-3 transition-colors',
        isCurrent && 'border-[#00d084]/40 bg-[#00d084]/[0.04]',
        isFuture && 'opacity-50',
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className={cn(
            'text-xs font-semibold uppercase tracking-[0.18em]',
            isCurrent ? 'text-[#00d084]' : 'text-gray-400',
          )}>
            {street}
          </div>
          {streetData && (
            <div className="mt-1 text-[11px] text-gray-500">
              Pot {formatBB(streetData.potBefore)}
            </div>
          )}
        </div>

        {isCollapsible ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#2a2a2a] bg-black/20 text-gray-400 transition-colors hover:border-[#444444] hover:text-white"
            title={isCollapsed ? `Expand ${street}` : `Collapse ${street}`}
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform', isCollapsed && '-rotate-90')} />
          </button>
        ) : (
          <div className="text-[11px] text-gray-600">
            {isCurrent ? 'Current' : isFuture ? 'Pending' : 'Complete'}
          </div>
        )}
      </div>

      {isCollapsed ? null : (
        <>
          {streetData?.cards && streetData.cards.length > 0 && (
            <div className="mb-3 flex gap-1">
              {streetData.cards.map((card, cardIndex) => (
                <PokerCard
                  key={cardIndex}
                  card={card}
                  size="small"
                  className={cn(
                    isCurrent && cardIndex === (streetData.cards?.length ?? 0) - 1 && 'ring-1 ring-[#00d084]',
                  )}
                />
              ))}
            </div>
          )}

          {streetData && streetData.actions.length > 0 ? (
            <div className="space-y-2">
              {streetData.actions.map((action, actionIndex) => {
                const decisionLabel =
                  showAIDecisionNotes && action.actor === 'ai'
                    ? formatDecisionSource(action.decisionSource)
                    : null;

                return (
                  <div
                    key={actionIndex}
                    className="rounded-lg border border-white/5 bg-black/20 px-2.5 py-2"
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className={cn(
                          'inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                          getActorBadgeClasses(action),
                        )}
                      >
                        {getActorLabel(action)}
                      </span>
                      <div className="min-w-0">
                        <div className="text-[12px] leading-relaxed text-gray-200">
                          <span className="font-semibold text-gray-400">{action.position}</span>
                          <span className="text-gray-500"> - </span>
                          <span className={cn('font-semibold', getActionTextClasses(action))}>
                            {getActionText(action.type, action.amount, streetData.potBefore)}
                          </span>
                          {decisionLabel && (
                            <span
                              className="text-gray-500"
                              title={action.decisionDetail || decisionLabel}
                            >
                              {' '}({decisionLabel})
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-[11px] text-gray-500">
                          Pot after: {formatBB(action.potAfter)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : isCurrent ? (
            <div className="text-sm italic text-gray-500">
              Awaiting action...
            </div>
          ) : isFuture ? (
            <div className="text-sm italic text-gray-600">
              Not reached
            </div>
          ) : (
            <div className="text-sm italic text-gray-600">
              No actions recorded
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function ActionHistory({
  handId,
  history,
  currentStreet,
  phase,
  isOpen,
  onToggle,
  showAIDecisionNotes = false,
}: ActionHistoryProps) {
  const streetOrder: Street[] = ['preflop', 'flop', 'turn', 'river'];
  const currentIndex = streetOrder.indexOf(currentStreet);
  const [selectedView, setSelectedView] = useState<ActionHistoryView>(() => getDefaultView(phase, currentStreet));
  const [collapsedSections, setCollapsedSections] = useState<Record<Street, boolean>>(
    DEFAULT_ALL_SECTION_COLLAPSE,
  );

  useEffect(() => {
    setSelectedView(getDefaultView(phase, currentStreet));
  }, [currentStreet, handId, phase]);

  useEffect(() => {
    setCollapsedSections(DEFAULT_ALL_SECTION_COLLAPSE);
  }, [handId]);

  const streetsToRender = selectedView === 'all' ? streetOrder : [selectedView];
  const subtitle =
    selectedView === 'all'
      ? 'All streets with foldable sections'
      : `Focused on ${selectedView}`
  ;

  if (!isOpen) {
    return (
      <div className={cn(
        'flex h-full shrink-0 flex-col items-center gap-3 border-r border-[#333333] bg-[#050505] px-2 py-4',
        FRONTEND_SIDEBAR_CONFIG.collapsedRailWidthClass,
      )}>
        <button
          onClick={onToggle}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#333333] bg-white/5 text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
          title="Expand action history"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        <div className="flex flex-col items-center gap-2">
          <div className="rounded-lg border border-[#333333] bg-white/5 p-2 text-gray-400">
            <History className="h-4 w-4" />
          </div>
          <StreetTabs
            selectedView={selectedView}
            currentStreet={currentStreet}
            onSelect={setSelectedView}
            compact
          />
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      'flex h-full shrink-0 flex-col border-r border-[#333333] bg-[#050505]',
      FRONTEND_SIDEBAR_CONFIG.actionHistoryExpandedWidthClass,
      FRONTEND_SIDEBAR_CONFIG.actionHistoryExpandedWideWidthClass,
    )}>
      <div className="flex h-14 items-center justify-between border-b border-[#333333] px-4">
        <div>
          <div className="text-sm font-semibold text-white">Action History</div>
          <div className="text-[11px] text-gray-500">{subtitle}</div>
        </div>
        <button
          onClick={onToggle}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#333333] bg-white/5 text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
          title="Collapse action history"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="border-b border-[#222222] px-4 py-3">
        <StreetTabs
          selectedView={selectedView}
          currentStreet={currentStreet}
          onSelect={setSelectedView}
        />
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {streetsToRender.map(street => {
          const streetData = history.find(item => item.street === street);
          const index = streetOrder.indexOf(street);
          const isCurrent = phase !== 'showdown' && street === currentStreet;
          const isFuture = phase !== 'showdown' && index > currentIndex;
          const isAllView = selectedView === 'all';

          return (
            <StreetSection
              key={street}
              street={street}
              streetData={streetData}
              isCurrent={isCurrent}
              isFuture={isFuture}
              isCollapsed={isAllView ? collapsedSections[street] : false}
              isCollapsible={isAllView}
              onToggleCollapse={
                isAllView
                  ? () => setCollapsedSections(prev => ({ ...prev, [street]: !prev[street] }))
                  : undefined
              }
              showAIDecisionNotes={showAIDecisionNotes}
            />
          );
        })}
      </div>
    </div>
  );
}
