import { useState, useCallback, useEffect, useRef } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { Action, GameState, Player, StreetHistory, TestConfig, ShowdownResult, Card } from '@/types/poker';
import { DEFAULT_TEST_CONFIG } from '@/types/poker';
import { formatBB, getScenarioLabel } from '@/lib/poker-utils';
import { generateHoleCards } from '@/lib/range-utils';
import {
  createSRPGame,
  createRepeatHandGame,
  createIdleTable,
  getOpponentAction,
  advanceStreet,
  getCardsForStreet,
  resolveShowdown,
  saveHandToHistory,
  createDeck,
  shuffleDeck,
} from '@/lib/game-engine';
import { PlayerPosition } from '@/components/PlayerPosition';
import { PokerCard, WaitingCard } from '@/components/PokerCard';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { HandHistoryDrawer } from '@/components/HandHistoryDrawer';
import { SettingsDialog } from '@/components/SettingsDialog';
import { CustomHandDialog } from '@/components/CustomHandDialog';
import { ActionHistoryPopover } from '@/components/ActionHistoryPopover';
import { ActionHistory } from '@/components/ActionHistory';
import { EMPTY_RIVER_EXPLOIT_TRACE, RiverExploitSidebar } from '@/components/RiverExploitSidebar';
import type { RiverExploitTrace } from '@/components/RiverExploitSidebar';
import { Settings, History, LogOut, Play, User, RotateCcw, SkipForward } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getPlayerSeats, getSeatPosition } from '@/lib/position-utils';
import { useAuth } from '@/contexts/AuthContext';
import { handHistoryKey, quickBetSizesKey, testConfigKey } from '@/lib/auth';
import { normalizeTestConfig } from '@/lib/test-config';
import type { ReactNode } from 'react';
import {
  FRONTEND_LAYOUT_CONFIG,
  FRONTEND_RIVER_EXPLOIT_CONFIG,
  FRONTEND_STORAGE_CONFIG,
  FRONTEND_TABLE_CONFIG,
} from '@/config/frontend-config';

// ─── TableView Component ─────────────────────────────────────────────────────

interface TableViewProps {
  gameState: GameState;
  isActive: boolean;
  tableNumber: number;
  isSingleView: boolean;
  quickBetSizes: number[];
  showOpponentCards: boolean;
  showFaceUpOpponentCards: boolean;
  showAIDecisionNotes: boolean;
  showRiverExploitSidebar: boolean;
  riverExploitTrace: RiverExploitTrace;
  onAction: (action: 'check' | 'fold' | 'call' | 'bet' | 'raise' | 'allin', amount?: number) => void;
  onStartNew: () => void;
  onRepeatHand: () => void;
  onLeave: () => void;
  onNextHand: () => void;
}

function TableView({
  gameState,
  isActive,
  tableNumber,
  isSingleView,
  quickBetSizes,
  showOpponentCards,
  showFaceUpOpponentCards,
  showAIDecisionNotes,
  showRiverExploitSidebar,
  riverExploitTrace,
  onAction,
  onStartNew,
  onRepeatHand,
  onLeave,
  onNextHand,
}: TableViewProps) {
  const [selectedBet, setSelectedBet] = useState(
    gameState.pot * 0.5 || FRONTEND_TABLE_CONFIG.minimumBetSizeBb,
  );
  const [customBetInput, setCustomBetInput] = useState('');
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showNextConfirm, setShowNextConfirm] = useState(false);
  const [isActionHistoryOpen, setIsActionHistoryOpen] = useState(
    () =>
      isSingleView &&
      (
        typeof window === 'undefined' ||
        window.innerWidth >= FRONTEND_LAYOUT_CONFIG.desktopSidebarAutoOpenBreakpointPx
      )
  );
  const [isRiverExploitOpen, setIsRiverExploitOpen] = useState(false);
  const tableAreaClasses = isSingleView
    ? FRONTEND_LAYOUT_CONFIG.singleViewTableAreaClasses
    : FRONTEND_LAYOUT_CONFIG.multiViewTableAreaClasses;

  const heroPlayer = gameState.players.find(p => p.isHero);
  const villainPlayer = gameState.players.find(p => !p.isHero && p.isActive && !p.hasFolded);
  const pot = gameState.pot;
  const currentBet = gameState.currentBet;
  const isHeroTurn = gameState.currentPosition === heroPlayer?.position;
  const phase = gameState.phase;

  useEffect(() => {
    if (
      showRiverExploitSidebar &&
      (
        riverExploitTrace.status === 'loading' ||
        riverExploitTrace.status === 'streaming' ||
        riverExploitTrace.action ||
        riverExploitTrace.error ||
        riverExploitTrace.finalMarkdown ||
        riverExploitTrace.systemMarkdown ||
        riverExploitTrace.userMarkdown ||
        riverExploitTrace.reasoningMarkdown ||
        riverExploitTrace.warning
      )
    ) {
      setIsRiverExploitOpen(true);
    }
  }, [
    riverExploitTrace.action,
    riverExploitTrace.error,
    riverExploitTrace.finalMarkdown,
    riverExploitTrace.reasoningSupported,
    riverExploitTrace.reasoningMarkdown,
    riverExploitTrace.status,
    riverExploitTrace.systemMarkdown,
    riverExploitTrace.userMarkdown,
    riverExploitTrace.warning,
    showRiverExploitSidebar,
  ]);

  // Map players to visual seats
  const playerSeats = getPlayerSeats(gameState.players);

  // Action availability
  const heroCurrentBet = heroPlayer?.currentBet ?? 0;
  const toCall = currentBet - heroCurrentBet;
  const heroStack = heroPlayer?.stack ?? 0;
  const villainIsAllin = (villainPlayer?.stack ?? 1) < 0.01 && (villainPlayer?.currentBet ?? 0) > 0;
  const canCheck = isHeroTurn && toCall === 0;
  const canCall = isHeroTurn && toCall > 0;
  const canBet = isHeroTurn && currentBet === 0;

  // Min bet = 1bb, min raise = current bet + last raise size (at least 1bb more)
  const minBet = FRONTEND_TABLE_CONFIG.minimumBetSizeBb;
  const minRaiseTotal = currentBet + Math.max(
    gameState.lastRaiseSize,
    FRONTEND_TABLE_CONFIG.minimumRaiseIncrementBb,
  );
  const minRaiseAmount = minRaiseTotal - heroCurrentBet;

  // Cannot raise when villain has gone all-in (no chips left to re-raise against)
  // or when hero doesn't have enough chips to cover the minimum raise
  const canRaise = isHeroTurn && currentBet > 0 && !villainIsAllin && heroStack >= minRaiseAmount;
  const canFold = isHeroTurn && toCall > 0;
  const canAllin = isHeroTurn && heroStack > 0;

  const handleQuickBet = (percentage: number) => {
    const opponentBet = currentBet - heroCurrentBet; // what opponent has bet that we need to call
    let amount: number;
    if (opponentBet > 0) {
      // Raise formula: (pot + opponentBet * 2) * percentage + opponentBet
      amount = (pot + opponentBet * 2) * (percentage / 100) + opponentBet;
    } else {
      // Bet formula: pot * percentage
      amount = pot * (percentage / 100);
    }
    amount = Math.max(minBet, Math.round(amount * 2) / 2); // round to 0.5bb
    setSelectedBet(amount);
  };

  const handleCustomBet = () => {
    const amount = parseFloat(customBetInput);
    if (!isNaN(amount) && amount >= minBet) {
      setSelectedBet(amount);
      setCustomBetInput('');
    }
  };

  const handleBet = () => {
    let amount = Math.max(minBet, selectedBet);
    if (amount >= heroStack) {
      onAction('allin', heroStack);
    } else {
      onAction('bet', amount);
    }
  };

  const handleRaise = () => {
    let amount = Math.max(minRaiseAmount, selectedBet);
    if (amount >= heroStack) {
      onAction('allin', heroStack);
    } else {
      onAction('raise', amount);
    }
  };

  const handleCall = () => {
    if (toCall >= heroStack) {
      onAction('allin', heroStack);
    } else {
      onAction('call', toCall);
    }
  };

  const renderWithSidebar = (content: ReactNode, showSidebar: boolean = true) => {
    if (!isSingleView || !showSidebar) {
      return content;
    }

    return (
      <div className="flex h-full min-h-0">
        <ActionHistory
          handId={gameState.id}
          history={gameState.history}
          currentStreet={gameState.currentStreet}
          phase={gameState.phase}
          isOpen={isActionHistoryOpen}
          onToggle={() => setIsActionHistoryOpen(prev => !prev)}
          showAIDecisionNotes={showAIDecisionNotes}
        />
        <div className="min-w-0 flex-1">
          {content}
        </div>
        {showRiverExploitSidebar && (
          <RiverExploitSidebar
            trace={riverExploitTrace}
            isOpen={isRiverExploitOpen}
            onToggle={() => setIsRiverExploitOpen(prev => !prev)}
          />
        )}
      </div>
    );
  };

  // ─── Idle View ───────────────────────────────────────────────────────────

  if (phase === 'idle') {
    return renderWithSidebar((
      <div className={cn('flex flex-col', !isSingleView && 'border-r border-b border-[#333333]')}>
        {!isSingleView && (
          <div className="h-8 border-b border-[#333333] flex items-center justify-between px-3">
            <div className="text-xs text-gray-500">Table {tableNumber}</div>
          </div>
        )}
        <div className={cn(
          'relative flex items-center justify-center',
          tableAreaClasses,
        )}>
          <div className="relative w-full h-full border border-[#333333]" style={{ borderRadius: '50%' }}>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-4">
              <div className={cn('text-gray-500', isSingleView ? 'text-lg' : 'text-sm')}>
                等待开局
              </div>
            </div>

            {/* Show empty player slots */}
            {playerSeats.map(({ player, seatIndex }) => {
              const position = getSeatPosition(seatIndex, isSingleView);
              return (
                <div key={player.position} className="absolute" style={position}>
                  <div className="flex flex-col items-center gap-1">
                    <PlayerPosition player={player} size={isSingleView ? undefined : 'small'} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {/* Empty action area */}
        <div className={cn(
          'border-t border-[#333333] flex flex-col items-center justify-center gap-2',
          isSingleView ? 'h-32' : 'h-24'
        )}>
          <div className="text-gray-600 text-xs mb-1">点击 Start New 开始新的一手</div>
          {gameState.initialDeck && (
            <Button
              onClick={onRepeatHand}
              variant="outline"
              size={isSingleView ? 'default' : 'sm'}
              className="border-[#00d084] text-[#00d084] hover:bg-[#00d084]/10 font-semibold gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Repeat Hand
            </Button>
          )}
          <Button
            onClick={onStartNew}
            size={isSingleView ? 'default' : 'sm'}
            className="bg-[#00d084] hover:bg-[#00d084]/90 text-black font-semibold gap-2 px-6"
          >
            <Play className="w-4 h-4" />
            Start New
          </Button>
        </div>
      </div>
    ), false);
  }

  // ─── Showdown View ───────────────────────────────────────────────────────

  if (phase === 'showdown') {
    const result = gameState.showdownResult;
    const heroWon = result?.winnerId === heroPlayer?.position;
    const isSplit = result?.winnerId === null;

    return renderWithSidebar((
      <div className={cn('flex flex-col', !isSingleView && 'border-r border-b border-[#333333]')}>
        {!isSingleView && (
          <div className="h-8 border-b border-[#333333] flex items-center justify-between px-3">
            <div className="text-xs text-gray-500">Table {tableNumber}</div>
            <div className="text-xs text-gray-400">Hand #{gameState.handNumber}</div>
          </div>
        )}
        <div className={cn(
          'relative flex items-center justify-center',
          tableAreaClasses,
        )}>
          <div className="relative w-full h-full border border-[#333333]" style={{ borderRadius: '50%' }}>
            {/* Center: result */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2">
              <div className={cn('text-gray-400', isSingleView ? 'text-xs' : 'text-[10px]')}>
                {getScenarioLabel(gameState.config)}
              </div>

              <div className={cn('font-bold flex items-center gap-2', isSingleView ? 'text-3xl' : 'text-xl')}>
                Pot: {formatBB(pot)}
                <ActionHistoryPopover
                  history={gameState.history}
                  isSingleView={isSingleView}
                  showAIDecisionNotes={showAIDecisionNotes}
                />
              </div>

              {/* Community Cards */}
              {gameState.communityCards.length > 0 && (
                <div className={cn('flex gap-1 mt-1', isSingleView && 'gap-2')}>
                  {gameState.communityCards.map((card, i) => (
                    <PokerCard key={i} card={card} size={isSingleView ? 'medium' : 'small'} />
                  ))}
                </div>
              )}

              {/* Result */}
              {result && (
                <div className={cn(
                  'font-bold mt-2',
                  isSingleView ? 'text-xl' : 'text-base',
                  heroWon ? 'text-[#00d084]' : isSplit ? 'text-yellow-400' : 'text-[#d04040]'
                )}>
                  {heroWon
                    ? `You Win +${formatBB(result.heroProfit)}`
                    : isSplit
                      ? 'Split Pot'
                      : `You Lose ${formatBB(result.heroProfit)}`}
                </div>
              )}

              {result && (
                <div className={cn('text-gray-500 text-center', isSingleView ? 'text-xs' : 'text-[10px]')}>
                  <div>Hero: {result.heroHandRank}</div>
                  <div>Villain: {result.villainHandRank}</div>
                </div>
              )}
            </div>

            {/* Players with revealed cards */}
            {playerSeats.map(({ player, seatIndex }) => {
              const position = getSeatPosition(seatIndex, isSingleView);
              const isHero = player.isHero;
              const showCards =
                !!player.cards &&
                (isHero || (!isHero && showOpponentCards && (player.isActive || player.hasFolded)));
              const cardSize = isSingleView ? (isHero ? 'large' : 'medium') : 'small';

              return (
                <div key={player.position} className="absolute" style={position}>
                  <div className={cn('flex flex-col items-center', isSingleView ? 'gap-3' : 'gap-1')}>
                    <PlayerPosition player={player} size={isSingleView ? undefined : 'small'} />
                    {showCards && player.cards && (
                      <div className={cn('flex', isSingleView ? 'gap-2' : 'gap-1')}>
                        <PokerCard card={player.cards[0]} size={cardSize} />
                        <PokerCard card={player.cards[1]} size={cardSize} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {/* Showdown action area */}
        <div className={cn(
          'border-t border-[#333333] flex items-center justify-center gap-4',
          isSingleView ? 'h-32' : 'h-24'
        )}>
          <Button
            onClick={onLeave}
            variant="outline"
            size={isSingleView ? 'default' : 'sm'}
            className="border-[#333333] hover:bg-white/5 text-gray-300 gap-2"
          >
            <LogOut className="w-4 h-4" />
            Leave
          </Button>
          <Button
            onClick={onStartNew}
            size={isSingleView ? 'default' : 'sm'}
            className="bg-[#00d084] hover:bg-[#00d084]/90 text-black font-semibold gap-2"
          >
            <Play className="w-4 h-4" />
            Start New
          </Button>

          {gameState.initialDeck && (
            <Button
              onClick={onRepeatHand}
              variant="outline"
              size={isSingleView ? 'default' : 'sm'}
              className="border-[#00d084] text-[#00d084] hover:bg-[#00d084]/10 font-semibold gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Repeat Hand
            </Button>
          )}
        </div>
      </div>
    ));
  }

  // ─── Playing View ────────────────────────────────────────────────────────

  return renderWithSidebar((
    <div className={cn('flex flex-col', !isSingleView && 'border-r border-b border-[#333333]')}>
      {/* Table Header (multi-table only) */}
      {!isSingleView && (
        <div className="h-8 border-b border-[#333333] flex items-center justify-between px-3">
          <div className="text-xs text-gray-500">Table {tableNumber}</div>
          <div className="flex items-center gap-2">
            <div className="text-xs text-gray-400">Hand #{gameState.handNumber}</div>
            <button
              onClick={() => setShowNextConfirm(true)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              title="Next Hand"
            >
              <SkipForward className="w-3 h-3" />
            </button>
            <button
              onClick={() => setShowLeaveConfirm(true)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              title="Leave"
            >
              <LogOut className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Poker Table */}
      <div className={cn(
        'relative flex items-center justify-center',
        tableAreaClasses,
      )}>
        {/* Leave button - top right of table area (single view) */}
        {isSingleView && (
          <button
            onClick={() => setShowLeaveConfirm(true)}
            className="absolute top-4 right-4 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#333333] text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors text-sm"
          >
            <LogOut className="w-4 h-4" />
            Leave
          </button>
        )}
        {/* Next Hand button - bottom right of table area (single view) */}
        {isSingleView && (
          <button
            onClick={() => setShowNextConfirm(true)}
            className="absolute bottom-4 right-4 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-[#555555] text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors text-sm"
          >
            <SkipForward className="w-4 h-4" />
            Next
          </button>
        )}
        <div className="relative w-full h-full border border-[#333333]" style={{ borderRadius: '50%' }}>
          {/* Center Info */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2">
            <div className={cn('text-gray-400 whitespace-nowrap', isSingleView ? 'text-xs' : 'text-[10px]')}>
              {getScenarioLabel(gameState.config)}
            </div>

            {/* Pot display — dual when facing a bet, single otherwise */}
            {isHeroTurn && toCall > 0 ? (
              <div className="flex flex-col items-center gap-0.5">
                {/* Pot before villain's bet */}
                <div className={cn('text-gray-500 font-semibold line-through decoration-gray-600', isSingleView ? 'text-xl' : 'text-sm')}>
                  {formatBB(pot - (villainPlayer?.currentBet ?? 0))}
                </div>
                {/* Current pot including villain's bet */}
                <div className={cn('font-bold text-[#00d084]', isSingleView ? 'text-5xl' : 'text-2xl')}>
                  {formatBB(pot)}
                </div>
              </div>
            ) : (
              <div className={cn('font-bold', isSingleView ? 'text-5xl' : 'text-2xl')}>
                {formatBB(pot)}
              </div>
            )}

            {/* Community Cards */}
            {gameState.communityCards.length > 0 && (
              <div className={cn('flex gap-1 mt-1', isSingleView && 'gap-2')}>
                {gameState.communityCards.map((card, i) => (
                  <PokerCard key={i} card={card} size={isSingleView ? 'medium' : 'small'} />
                ))}
              </div>
            )}

            <div className={cn('text-gray-400 flex items-center gap-2', isSingleView ? 'text-xs mt-2' : 'text-[10px] mt-1')}>
              <div className={cn('rounded-full bg-gray-600', isSingleView ? 'w-4 h-4' : 'w-3 h-3')} />
              {formatBB(pot)}
              <ActionHistoryPopover
                history={gameState.history}
                isSingleView={isSingleView}
                showAIDecisionNotes={showAIDecisionNotes}
              />
            </div>

            {/* Current bet info */}
            {isHeroTurn && toCall > 0 && (
              <div className={cn('text-[#ff8c00] font-semibold', isSingleView ? 'text-sm' : 'text-xs')}>
                To call: {formatBB(toCall)}
              </div>
            )}

            {/* Waiting for opponent */}
            {!isHeroTurn && gameState.currentPosition && (
              <div className={cn('text-gray-500', isSingleView ? 'text-sm' : 'text-xs')}>
                等待对手行动...
              </div>
            )}
          </div>

          {/* Players */}
          {playerSeats.map(({ player, seatIndex }) => {
            const position = getSeatPosition(seatIndex, isSingleView);
            const isHero = player.isHero;
            const cardSize = isSingleView ? (isHero ? 'large' : 'medium') : 'small';
            const gap = isSingleView ? 'gap-3' : 'gap-1';
            const revealOpponentCardsInPlay =
              showFaceUpOpponentCards && !isHero && player.isActive && !player.hasFolded && !!player.cards;

            return (
              <div key={player.position} className="absolute" style={position}>
                <div className={cn('flex flex-col items-center', gap)}>
                  <PlayerPosition player={player} size={isSingleView ? undefined : 'small'} />
                  {isHero && player.cards ? (
                    <div className={cn('flex', isSingleView ? 'gap-2' : 'gap-1')}>
                      <PokerCard card={player.cards[0]} size={cardSize} />
                      <PokerCard card={player.cards[1]} size={cardSize} />
                    </div>
                  ) : revealOpponentCardsInPlay && player.cards ? (
                    <div className={cn('flex', isSingleView ? 'gap-2' : 'gap-1')}>
                      <PokerCard card={player.cards[0]} size={cardSize} />
                      <PokerCard card={player.cards[1]} size={cardSize} />
                    </div>
                  ) : player.isActive && !player.hasFolded && !isHero ? (
                    <div className={cn('flex', isSingleView ? 'gap-2' : 'gap-1')}>
                      <WaitingCard size={cardSize} />
                      <WaitingCard size={cardSize} />
                    </div>
                  ) : null}
                  {/* Show current street bet if any */}
                  {player.currentBet > 0 && (
                    <div className={cn(
                      'text-[#ff8c00] font-semibold',
                      isSingleView ? 'text-xs' : 'text-[10px]'
                    )}>
                      {formatBB(player.currentBet)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Action Area */}
      <div className={cn(
        'border-t border-[#333333] flex items-center justify-center gap-3 px-4',
        isSingleView ? 'h-32' : 'h-24'
      )}>
        {isHeroTurn ? (
          <>
            {/* Quick Bet Buttons (Pot %) - 2 rows */}
            <div className={cn('grid grid-cols-4', isSingleView ? 'gap-3' : 'gap-1.5')}>
              {quickBetSizes.map((percentage) => (
                <button
                  key={percentage}
                  onClick={() => handleQuickBet(percentage)}
                  className={cn(
                    'rounded-lg font-semibold transition-all px-3 border-2',
                    isSingleView ? 'h-11 text-sm min-w-[60px]' : 'h-8 text-xs min-w-[48px]',
                    selectedBet === Math.round(pot * (percentage / 100) * 2) / 2
                      ? 'bg-transparent border-[#00d084] text-[#00d084]'
                      : 'bg-[#2a2a2a] border-transparent text-white hover:bg-[#333333]'
                  )}
                >
                  {percentage}%
                </button>
              ))}
            </div>

            {/* Custom Bet Input */}
            <div className="flex items-center gap-1">
              <Input
                type="number"
                step="0.5"
                min={minBet}
                placeholder="bb"
                value={customBetInput}
                onChange={(e) => setCustomBetInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCustomBet();
                }}
                className={cn(
                  'bg-[#1a1a1a] border-[#333333] text-center',
                  isSingleView ? 'w-20 h-10' : 'w-16 h-8 text-xs'
                )}
              />
            </div>

            {/* Bet Slider */}
            <div className="flex-1 max-w-xs">
              <div className={cn('text-center mb-1 font-semibold', isSingleView ? 'text-sm' : 'text-xs')}>
                {selectedBet.toFixed(1)} bb
              </div>
              <Slider
                value={[selectedBet]}
                onValueChange={([value]) => setSelectedBet(Math.max(minBet, value))}
                min={minBet}
                max={heroStack || 100}
                step={0.5}
                className="w-full"
              />
            </div>

            {/* Main Actions */}
            <div className="flex gap-2">

              {/* FOLD — only when facing a bet */}
              <Button
                onClick={() => onAction('fold')}
                disabled={!canFold}
                size={isSingleView ? 'default' : 'sm'}
                className={cn(
                  'font-semibold',
                  isSingleView ? 'w-24 h-10' : 'w-16 h-8 text-xs',
                  canFold
                    ? 'bg-[#666666] hover:bg-[#666666]/90 text-white'
                    : 'bg-[#333333] text-gray-600 cursor-not-allowed'
                )}
              >
                FOLD
              </Button>

              {/* CHECK — when no bet to face */}
              <Button
                onClick={() => onAction('check')}
                disabled={!canCheck}
                size={isSingleView ? 'default' : 'sm'}
                className={cn(
                  'font-semibold',
                  isSingleView ? 'w-24 h-10' : 'w-16 h-8 text-xs',
                  canCheck
                    ? 'bg-[#00d084] hover:bg-[#00d084]/90 text-black'
                    : 'bg-[#333333] text-gray-600 cursor-not-allowed'
                )}
              >
                CHECK
              </Button>

              {/* CALL — when facing a bet */}
              {canCall && (
                <Button
                  onClick={handleCall}
                  size={isSingleView ? 'default' : 'sm'}
                  className={cn(
                    'font-semibold bg-[#00d084] hover:bg-[#00d084]/90 text-black',
                    isSingleView ? 'w-28 h-10' : 'w-20 h-8 text-xs'
                  )}
                >
                  CALL {formatBB(Math.min(toCall, heroStack))}
                </Button>
              )}

              {/* BET — when no current bet */}
              <Button
                onClick={handleBet}
                disabled={!canBet}
                size={isSingleView ? 'default' : 'sm'}
                className={cn(
                  'font-semibold',
                  isSingleView ? 'w-28 h-10' : 'w-20 h-8 text-xs',
                  canBet
                    ? 'bg-[#d04040] hover:bg-[#d04040]/90 text-white'
                    : 'bg-[#333333] text-gray-600 cursor-not-allowed'
                )}
              >
                BET {selectedBet.toFixed(1)}
              </Button>

              {/* RAISE — when facing a bet */}
              <Button
                onClick={handleRaise}
                disabled={!canRaise}
                size={isSingleView ? 'default' : 'sm'}
                className={cn(
                  'font-semibold',
                  isSingleView ? 'w-28 h-10' : 'w-20 h-8 text-xs',
                  canRaise
                    ? 'bg-[#ff8c00] hover:bg-[#ff8c00]/90 text-white'
                    : 'bg-[#333333] text-gray-600 cursor-not-allowed'
                )}
              >
                RAISE {Math.max(minRaiseAmount, selectedBet).toFixed(1)}
              </Button>

              {/* ALL-IN */}
              {canAllin && (
                <Button
                  onClick={() => onAction('allin', heroStack)}
                  size={isSingleView ? 'default' : 'sm'}
                  className={cn(
                    'font-semibold bg-[#9333ea] hover:bg-[#9333ea]/90 text-white',
                    isSingleView ? 'w-28 h-10' : 'w-20 h-8 text-xs'
                  )}
                >
                  ALL-IN {formatBB(heroStack)}
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-4">
            <div className="text-gray-500 text-sm">
              {gameState.currentPosition ? '等待对手行动...' : ''}
            </div>
            <Button
              onClick={onLeave}
              variant="outline"
              size="sm"
              className="border-[#333333] hover:bg-white/5 text-gray-400 gap-2"
            >
              <LogOut className="w-4 h-4" />
              Leave
            </Button>
          </div>
        )}
      </div>

      {/* Leave Confirmation Dialog */}
      <AlertDialog open={showLeaveConfirm} onOpenChange={setShowLeaveConfirm}>
        <AlertDialogContent className="bg-[#0a0a0a] border-[#333333] text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>确认离开</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              当前正在进行一手牌，离开将放弃本手牌的进度。确定要离开吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#333333] hover:bg-white/5 text-gray-300">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowLeaveConfirm(false);
                onLeave();
              }}
              className="bg-[#d04040] hover:bg-[#d04040]/90 text-white"
            >
              确认离开
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Next Hand Confirmation Dialog */}
      <AlertDialog open={showNextConfirm} onOpenChange={setShowNextConfirm}>
        <AlertDialogContent className="bg-[#0a0a0a] border-[#333333] text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>开始下一手</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              当前这手牌尚未结束，确认放弃并直接开始下一手牌吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#333333] hover:bg-white/5 text-gray-300">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowNextConfirm(false);
                onNextHand();
              }}
              className="bg-[#00d084] hover:bg-[#00d084]/90 text-black font-semibold"
            >
              确认，开始下一手
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  ));
}

// ─── Main GameTable Component ────────────────────────────────────────────────

function getActiveVillain(gameState: GameState) {
  return gameState.players.find(p => !p.isHero && p.isActive && !p.hasFolded);
}

type OpponentDecision = {
  action: Action['type'];
  amount?: number;
  decisionSource?: string;
  decisionDetail?: string;
};

type RiverExploitEvent =
  | { type: 'status'; status?: string; message?: string }
  | { type: 'system_markdown'; content?: string }
  | { type: 'user_markdown'; content?: string }
  | { type: 'meta'; model?: string; decision_mode?: string; reasoning_supported?: boolean }
  | { type: 'reasoning_delta'; content?: string }
  | { type: 'final_delta'; content?: string }
  | { type: 'parsed_output'; strategy?: Record<string, number> }
  | {
      type: 'decision';
      action?: string;
      strategy?: Record<string, number>;
      decision_source?: string;
      decision_detail?: string;
      strategy_hand_used?: string;
    }
  | { type: 'warning'; message?: string }
  | { type: 'error'; message?: string }
  | { type: 'complete'; status?: string };

const RIVER_REASONING_TIMEOUT_MS = FRONTEND_RIVER_EXPLOIT_CONFIG.reasoningTimeoutMs;
const RIVER_EXPLOIT_STALE_REQUEST = FRONTEND_RIVER_EXPLOIT_CONFIG.staleRequestMarker;

function createEmptyRiverExploitTrace(): RiverExploitTrace {
  return { ...EMPTY_RIVER_EXPLOIT_TRACE };
}

async function readNdjsonStream(
  response: Response,
  onEvent: (event: RiverExploitEvent) => void,
): Promise<void> {
  if (!response.body) {
    throw new Error('The backend did not return a readable streaming body.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      onEvent(JSON.parse(line) as RiverExploitEvent);
    }

    if (done) break;
  }

  if (buffer.trim()) {
    onEvent(JSON.parse(buffer) as RiverExploitEvent);
  }
}

function getHistoryActionActor(gameState: Pick<GameState, 'players'>, position: Action['position']): Action['actor'] {
  const player = gameState.players.find(p => p.position === position);
  if (!player) return 'other';
  if (player.isHero) return 'hero';
  return player.isActive ? 'ai' : 'other';
}

function createHistoryAction(
  gameState: Pick<GameState, 'players'>,
  action: Omit<Action, 'timestamp' | 'actor'>,
): Action {
  return {
    ...action,
    actor: getHistoryActionActor(gameState, action.position),
    timestamp: new Date(),
  };
}

export default function GameTable() {
  const { user, logout } = useAuth();
  const isTestFeatureEnabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_TEST_FEATURES === 'true';
  const [tableCount, setTableCount] = useState<number>(FRONTEND_TABLE_CONFIG.supportedTableCounts[0]);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [testConfig, setTestConfig] = useState<TestConfig>(() => {
    const key = user ? testConfigKey(user.username) : FRONTEND_STORAGE_CONFIG.testConfigStorePrefix;
    const stored = localStorage.getItem(key);
    if (!stored) {
      return normalizeTestConfig(DEFAULT_TEST_CONFIG);
    }

    try {
      return normalizeTestConfig({ ...DEFAULT_TEST_CONFIG, ...JSON.parse(stored) });
    } catch {
      return normalizeTestConfig(DEFAULT_TEST_CONFIG);
    }
  });
  const [tables, setTables] = useState<GameState[]>(() => {
    return FRONTEND_TABLE_CONFIG.supportedTableCounts.map(() => createIdleTable(0, testConfig));
  });
  const [activeTable, setActiveTable] = useState(0);
  const [quickBetSizes, setQuickBetSizes] = useState<number[]>(() => {
    const key = user ? quickBetSizesKey(user.username) : FRONTEND_STORAGE_CONFIG.quickBetSizesStorePrefix;
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [...FRONTEND_TABLE_CONFIG.defaultQuickBetPercentages];
  });
  const [showHandHistory, setShowHandHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCustomHandDialog, setShowCustomHandDialog] = useState(false);
  const [customHandTableIndex, setCustomHandTableIndex] = useState<number | null>(null);
  const showOpponentCards = testConfig.showOpponentCards ?? true;
  const showFaceUpOpponentCards = isTestFeatureEnabled && (testConfig.showFaceUpOpponentCards ?? false);
  const showAIDecisionNotes = isTestFeatureEnabled && (testConfig.showAIDecisionNotes ?? false);
  const enableRiverLLMExploit = isTestFeatureEnabled && (testConfig.enableRiverLLMExploit ?? false);
  const [riverExploitTraces, setRiverExploitTraces] = useState<RiverExploitTrace[]>(() =>
    FRONTEND_TABLE_CONFIG.supportedTableCounts.map(() => createEmptyRiverExploitTrace())
  );

  const latestTablesRef = useRef(tables);
  const prevStreetsRef = useRef<string[]>([]);
  /** 用于传给 processOpponentAction 的完整 table，避免 setState 异步导致 path 不完整 */
  const pendingOpponentTableRef = useRef<{ tableIndex: number; table: GameState } | null>(null);
  const riverExploitRequestIdsRef = useRef<number[]>(
    FRONTEND_TABLE_CONFIG.supportedTableCounts.map(() => 0),
  );
  const riverExploitAbortControllersRef = useRef<(AbortController | null)[]>(
    FRONTEND_TABLE_CONFIG.supportedTableCounts.map(() => null),
  );
  const latestTestConfigRef = useRef(testConfig);
  const enableRiverLLMExploitRef = useRef(enableRiverLLMExploit);

  useEffect(() => {
    latestTablesRef.current = tables;

    // Eager Solving/Pre-solve trigger
    tables.forEach((table, i) => {
      const streetKey = `${table.id}_${table.currentStreet}_${table.communityCards.length}`;
      if (prevStreetsRef.current[i] !== streetKey && table.phase === 'playing') {
        const villain = getActiveVillain(table);
        // If it's NOT the AI's turn, but a new card just dropped, notify backend to start solving
        if (villain && table.currentPosition !== villain.position) {
          triggerPreSolve(i);
        }
        // If AI acts first (heroActsFirst === false) and it's the AI's turn at street start,
        // automatically trigger opponent action on flop start (id changes = new hand)
        if (
          villain &&
          table.currentPosition === villain.position &&
          table.config.heroActsFirst === false
        ) {
          // Use a small delay so state is fully settled before AI acts
          setTimeout(() => processOpponentAction(i), FRONTEND_TABLE_CONFIG.aiActsFirstAutoActionDelayMs);
        }
      }
      prevStreetsRef.current[i] = streetKey;
    });
  }, [tables]);

  useEffect(() => {
    latestTestConfigRef.current = testConfig;
    enableRiverLLMExploitRef.current = enableRiverLLMExploit;
  }, [enableRiverLLMExploit, testConfig]);

  useEffect(() => {
    setRiverExploitTraces(prev => {
      let changed = false;
      const next = prev.map((trace, index) => {
        const table = tables[index];
        if (!table) return trace;
        if (trace.tableId && trace.tableId !== table.id) {
          changed = true;
          riverExploitRequestIdsRef.current[index] += 1;
          riverExploitAbortControllersRef.current[index]?.abort('reset');
          riverExploitAbortControllersRef.current[index] = null;
          return createEmptyRiverExploitTrace();
        }
        return trace;
      });
      return changed ? next : prev;
    });
  }, [tables]);

  /**
   * Build GTO path from table history, correctly mapping 'allin' actions to
   * CALL / BET <amount> / RAISE <amount> based on the street's betting context.
   *
   * Key issue: when a player calls an all-in they are stored as 'allin' in history,
   * but the GTO tree node only has 'CALL'. We detect this by replaying currentBet.
   */
  const buildGtoPath = useCallback((history: typeof tables[0]['history']): string[] => {
    const path: string[] = [];
    history.forEach(round => {
      if (round.street === 'preflop') return;
      if (round.street === 'turn' || round.street === 'river') {
        const cardGot = round.cards?.[0];
        if (cardGot) path.push(`DEAL:${cardGot.rank}${cardGot.suit[0]}`);
      }
      // Track street-level current bet to classify 'allin' as CALL / BET / RAISE
      let streetCurrentBet = 0;
      round.actions.forEach(a => {
        if (a.type === 'bet') {
          // bet.amount is the incremental bet size
          streetCurrentBet += a.amount!;
          path.push(`BET ${a.amount}`);
        } else if (a.type === 'raise') {
          // raise.amount is the total bet after raise
          streetCurrentBet = a.amount!;
          path.push(`RAISE ${a.amount}`);
        } else if (a.type === 'allin') {
          // allin.amount is the actor's total currentBet after going all-in
          const totalAfterAllin = a.amount ?? 0;
          if (totalAfterAllin <= streetCurrentBet) {
            // All-in for less than or equal to current bet → CALL
            path.push('CALL');
          } else if (streetCurrentBet === 0) {
            // First action on street, no prior bet → BET
            path.push(`BET ${totalAfterAllin}`);
            streetCurrentBet = totalAfterAllin;
          } else {
            // Re-raise situation → RAISE
            path.push(`RAISE ${totalAfterAllin}`);
            streetCurrentBet = totalAfterAllin;
          }
        } else if (a.type === 'call') {
          path.push('CALL');
          // streetCurrentBet stays the same (hero calling matches it)
        } else {
          path.push(a.type.toUpperCase()); // CHECK, FOLD
        }
      });
    });
    return path;
  }, []);

  const updateRiverExploitTrace = useCallback(
    (tableIndex: number, updater: (trace: RiverExploitTrace) => RiverExploitTrace) => {
      setRiverExploitTraces(prev =>
        prev.map((trace, index) => (index === tableIndex ? updater(trace) : trace))
      );
    },
    [],
  );

  const requestRiverLLMDecision = useCallback(async (
    tableIndex: number,
    tableToAct: GameState,
    heroInfo: Player,
    villainInfo: Player,
    path: string[],
    villainHole: string,
  ): Promise<OpponentDecision | null> => {
    const requestId = riverExploitRequestIdsRef.current[tableIndex] + 1;
    riverExploitRequestIdsRef.current[tableIndex] = requestId;
    riverExploitAbortControllersRef.current[tableIndex]?.abort('superseded');

    const abortController = new AbortController();
    riverExploitAbortControllersRef.current[tableIndex] = abortController;
    const reasoningStartedAt = Date.now();
    const reasoningLimitLabel = `${(RIVER_REASONING_TIMEOUT_MS / 1000).toFixed(0)}s`;
    let reasoningTimeoutHandle: number | null = null;
    let finalDecision: OpponentDecision | null = null;

    const isCurrentRequest = () => riverExploitRequestIdsRef.current[tableIndex] === requestId;
    const safeUpdate = (updater: (trace: RiverExploitTrace) => RiverExploitTrace) => {
      if (!isCurrentRequest()) return;
      updateRiverExploitTrace(tableIndex, updater);
    };

    const markReasoningComplete = (completedAt: number = Date.now()) => {
      if (reasoningTimeoutHandle !== null) {
        window.clearTimeout(reasoningTimeoutHandle);
        reasoningTimeoutHandle = null;
      }

      safeUpdate(trace => (
        trace.reasoningCompletedAt
          ? trace
          : {
              ...trace,
              reasoningCompletedAt: completedAt,
            }
      ));
    };

    safeUpdate(() => ({
      tableId: tableToAct.id,
      status: 'loading',
      model: null,
      reasoningSupported: null,
      systemMarkdown: '',
      userMarkdown: '',
      reasoningMarkdown: '',
      finalMarkdown: '',
      reasoningStartedAt,
      reasoningCompletedAt: null,
      reasoningTimeoutMs: RIVER_REASONING_TIMEOUT_MS,
      parsedStrategy: null,
      action: null,
      decisionSource: null,
      decisionDetail: null,
      warning: null,
      error: null,
    }));

    reasoningTimeoutHandle = window.setTimeout(() => {
      if (!isCurrentRequest()) return;

      safeUpdate(trace => ({
        ...trace,
        status: 'error',
        reasoningCompletedAt: trace.reasoningCompletedAt ?? (reasoningStartedAt + RIVER_REASONING_TIMEOUT_MS),
        warning: trace.warning ?? `Reasoning exceeded the ${reasoningLimitLabel} limit. Falling back to the baseline strategy.`,
        error: `The river exploit stream exceeded the ${reasoningLimitLabel} reasoning limit.`,
      }));
      abortController.abort('timeout');
    }, RIVER_REASONING_TIMEOUT_MS);

    try {
      const response = await fetch('/api/river-exploit-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          board: tableToAct.communityCards.map(c => `${c.rank}${c.suit[0]}`).join(','),
          path,
          hand: villainHole,
          effective_stack: Math.min(heroInfo.stack, villainInfo.stack),
          use_mdf: tableToAct.config.enableMDF || false,
          datasetSource: latestTestConfigRef.current.datasetSource,
          heroPosition: heroInfo.position,
          villainPosition: villainInfo.position,
          actorPosition: villainInfo.position,
          opponentPosition: heroInfo.position,
        }),
      });

      if (!isCurrentRequest()) {
        throw new Error(RIVER_EXPLOIT_STALE_REQUEST);
      }

      if (!response.ok) {
        markReasoningComplete();

        let message = `HTTP ${response.status}`;
        try {
          const payload = await response.json();
          if (payload?.error) {
            message = payload.error;
          }
        } catch {
          // Ignore JSON parsing issues for error responses.
        }

        safeUpdate(trace => ({
          ...trace,
          status: 'error',
          error: message,
        }));
        throw new Error(message);
      }

      await readNdjsonStream(response, event => {
        if (!isCurrentRequest()) return;

        if (event.type === 'status') {
          safeUpdate(trace => ({
            ...trace,
            status: event.status === 'complete' ? 'complete' : 'loading',
          }));
          return;
        }

        if (event.type === 'system_markdown') {
          safeUpdate(trace => ({
            ...trace,
            status: 'streaming',
            systemMarkdown: event.content ?? '',
          }));
          return;
        }

        if (event.type === 'user_markdown') {
          safeUpdate(trace => ({
            ...trace,
            status: 'streaming',
            userMarkdown: event.content ?? '',
          }));
          return;
        }

        if (event.type === 'meta') {
          if (event.reasoning_supported === false) {
            markReasoningComplete(reasoningStartedAt);
          }

          safeUpdate(trace => ({
            ...trace,
            model: event.model ?? trace.model,
            reasoningSupported:
              typeof event.reasoning_supported === 'boolean'
                ? event.reasoning_supported
                : trace.reasoningSupported,
            reasoningCompletedAt:
              event.reasoning_supported === false
                ? (trace.reasoningCompletedAt ?? reasoningStartedAt)
                : trace.reasoningCompletedAt,
          }));
          return;
        }

        if (event.type === 'reasoning_delta') {
          safeUpdate(trace => ({
            ...trace,
            status: 'streaming',
            reasoningMarkdown: `${trace.reasoningMarkdown}${event.content ?? ''}`,
          }));
          return;
        }

        if (event.type === 'final_delta') {
          markReasoningComplete();
          safeUpdate(trace => ({
            ...trace,
            status: 'streaming',
            finalMarkdown: `${trace.finalMarkdown}${event.content ?? ''}`,
          }));
          return;
        }

        if (event.type === 'parsed_output') {
          safeUpdate(trace => ({
            ...trace,
            parsedStrategy: event.strategy ?? trace.parsedStrategy,
          }));
          return;
        }

        if (event.type === 'warning') {
          safeUpdate(trace => ({
            ...trace,
            warning: event.message ?? trace.warning,
          }));
          return;
        }

        if (event.type === 'error') {
          markReasoningComplete();
          safeUpdate(trace => ({
            ...trace,
            status: 'error',
            error: event.message ?? 'The backend reported a river exploit error.',
          }));
          return;
        }

        if (event.type === 'decision') {
          markReasoningComplete();

          if (event.action) {
            const parts = event.action.split(' ');
            const action = parts[0]?.toLowerCase();
            if (['fold', 'check', 'call', 'bet', 'raise', 'allin'].includes(action)) {
              finalDecision = {
                action: action as Action['type'],
                amount: parts.length > 1 ? parseFloat(parts[1]) : undefined,
                decisionSource: typeof event.decision_source === 'string' ? event.decision_source : undefined,
                decisionDetail: typeof event.decision_detail === 'string' ? event.decision_detail : undefined,
              };
            }
          }

          safeUpdate(trace => ({
            ...trace,
            status: 'complete',
            parsedStrategy: event.strategy ?? trace.parsedStrategy,
            action: event.action ?? trace.action,
            decisionSource: event.decision_source ?? trace.decisionSource,
            decisionDetail: event.decision_detail ?? trace.decisionDetail,
          }));
          return;
        }

        if (event.type === 'complete') {
          markReasoningComplete();
          safeUpdate(trace => ({
            ...trace,
            status: trace.status === 'error' ? 'error' : 'complete',
          }));
        }
      });

      if (!isCurrentRequest()) {
        throw new Error(RIVER_EXPLOIT_STALE_REQUEST);
      }

      markReasoningComplete();
      return finalDecision;
    } catch (error) {
      if (abortController.signal.aborted) {
        const abortReason = abortController.signal.reason;
        if (abortReason === 'superseded' || abortReason === 'reset') {
          throw new Error(RIVER_EXPLOIT_STALE_REQUEST);
        }
        if (abortReason === 'timeout') {
          throw new Error(`The river exploit stream exceeded the ${reasoningLimitLabel} reasoning limit.`);
        }
      }

      if (!isCurrentRequest()) {
        throw new Error(RIVER_EXPLOIT_STALE_REQUEST);
      }

      throw error instanceof Error ? error : new Error('The river exploit request failed.');
    } finally {
      if (reasoningTimeoutHandle !== null) {
        window.clearTimeout(reasoningTimeoutHandle);
      }
      if (riverExploitAbortControllersRef.current[tableIndex] === abortController) {
        riverExploitAbortControllersRef.current[tableIndex] = null;
      }
    }
  }, [updateRiverExploitTrace]);

  const triggerPreSolve = useCallback(async (tableIndex: number, tableOverride?: GameState) => {
    const table = tableOverride ?? latestTablesRef.current[tableIndex];
    if (!table || table.phase !== 'playing') return;

    const boardCards = table.communityCards.map(c => `${c.rank}${c.suit[0]}`).join(',');
    const villain = getActiveVillain(table);
    const hero = table.players.find(p => p.isHero);
    if (!villain || !hero) return;

    let path: string[] = buildGtoPath(table.history);

    console.log(`[Pre-solve] Triggering for table ${tableIndex}, path: ${path.join(' -> ')}`);
    try {
      // Pre-run query request to warm up cache
      await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          board: boardCards,
          path,
          hand: '', // Hand doesn't matter for pre-solving street transition
          effective_stack: Math.min(hero.stack, villain.stack),
          use_mdf: table.config.enableMDF || false,
          datasetSource: latestTestConfigRef.current.datasetSource
        })
      });
    } catch (e) {
      console.error("Pre-solve trigger failed", e);
    }
  }, []);

  // ─── Start New Hand ────────────────────────────────────────────────────

  const handleStartNew = useCallback((tableIndex: number) => {
    if (testConfig.dealMode === 'custom') {
      setCustomHandTableIndex(tableIndex);
      setShowCustomHandDialog(true);
      return;
    }
    setTables(prev => prev.map((table, i) => {
      if (i !== tableIndex) return table;
      const newHandNumber = table.handNumber + 1;
      return createSRPGame(newHandNumber, testConfig);
    }));
  }, [testConfig]);

  const handleCustomHandConfirm = useCallback((selectedCards: Card[]) => {
    if (customHandTableIndex === null) return;

    const fullDeck = createDeck();
    const isSelected = (c: Card) => selectedCards.some(sc => sc.rank === c.rank && sc.suit === c.suit);
    let remainingCards = shuffleDeck(fullDeck.filter(c => !isSelected(c)));

    let forcedDeckPrefix: Card[];
    if (testConfig.customHoleCards) {
      // selectedCards length is 7: [hero1, hero2, villain1, villain2, flop1, flop2, flop3]
      forcedDeckPrefix = [...selectedCards];
    } else {
      // selectedCards length is 3: [flop1, flop2, flop3]
      const { heroHole, villainHole, remainingDeck } = generateHoleCards(testConfig, selectedCards, remainingCards);
      remainingCards = remainingDeck;
      forcedDeckPrefix = [...heroHole, ...villainHole, ...selectedCards];
    }

    const forcedDeck = [...forcedDeckPrefix, ...remainingCards];

    setTables(prev => prev.map((table, i) => {
      if (i !== customHandTableIndex) return table;
      const newHandNumber = table.handNumber + 1;
      return createSRPGame(newHandNumber, testConfig, forcedDeck);
    }));
    setShowCustomHandDialog(false);
    setCustomHandTableIndex(null);
  }, [customHandTableIndex, testConfig]);

  const handleRepeatHand = useCallback((tableIndex: number) => {
    setTables(prev => prev.map((table, i) => {
      if (i !== tableIndex) return table;
      // Keep community cards from the previous hand (flop always; turn/river only if dealt).
      // Re-deal both players' hole cards from scratch.
      return createRepeatHandGame(table, testConfig);
    }));
  }, [testConfig]);

  // ─── Leave Table ───────────────────────────────────────────────────────

  const handleLeave = useCallback((tableIndex: number) => {
    setTables(prev => prev.map((table, i) => {
      if (i !== tableIndex) return table;
      return createIdleTable(table.handNumber, testConfig);
    }));
  }, [testConfig]);

  // ─── Next Hand (Leave + Start New combined) ────────────────────────────

  const handleNextHand = useCallback((tableIndex: number) => {
    if (testConfig.dealMode === 'custom') {
      setCustomHandTableIndex(tableIndex);
      setShowCustomHandDialog(true);
      return;
    }
    setTables(prev => prev.map((table, i) => {
      if (i !== tableIndex) return table;
      const newHandNumber = table.handNumber + 1;
      return createSRPGame(newHandNumber, testConfig);
    }));
  }, [testConfig]);

  // ─── Process Action ────────────────────────────────────────────────────

  const handleAction = useCallback((
    tableIndex: number,
    action: 'check' | 'fold' | 'call' | 'bet' | 'raise' | 'allin',
    amount?: number,
  ) => {
    setTables(prev => prev.map((table, i) => {
      if (i !== tableIndex || table.phase !== 'playing') return table;

      const newTable = structuredClone(table);
      const hero = newTable.players.find(p => p.isHero)!;
      const villain = newTable.players.find(p => !p.isHero && p.isActive && !p.hasFolded)!;

      if (!hero || !villain || newTable.currentPosition !== hero.position) return table;

      // Record action in current street history
      const currentHistory = newTable.history.find(h => h.street === newTable.currentStreet);

      // Process hero action
      if (action === 'fold') {
        hero.hasFolded = true;
        newTable.currentPosition = null;
        newTable.phase = 'showdown';

        currentHistory?.actions.push(createHistoryAction(newTable, {
          position: hero.position,
          type: 'fold',
          potAfter: newTable.pot,
        }));

        // Villain wins — hero loses everything they put in
        const heroInvested = (newTable.config.stackDepthBB - 2.5) - hero.stack;
        newTable.showdownResult = {
          winnerId: villain.position,
          heroHandRank: '-',
          villainHandRank: '-',
          potWon: newTable.pot,
          heroProfit: -heroInvested,
        };

        if (hero.cards) {
          saveHandToHistory(
            newTable.id, hero.position, hero.cards, villain.position,
            newTable.communityCards, newTable.pot, -heroInvested,
            newTable.effectiveStack, newTable.history,
          );
        }
        return newTable;

      } else if (action === 'check') {
        currentHistory?.actions.push(createHistoryAction(newTable, {
          position: hero.position,
          type: 'check',
          potAfter: newTable.pot,
        }));

        // Check if betting round should end (both players checked / bet matched)
        // If hero checks and villain hasn't acted yet this street, villain's turn
        // If hero checks after villain checked, advance street
        const villainActedThisStreet = currentHistory?.actions.some(a => a.position === villain.position) ?? false;

        if (villainActedThisStreet) {
          // Both checked — advance street
          advanceToNextStreet(newTable, hero, villain, tableIndex);
        } else {
          // Villain's turn — 保存完整 table 供 processOpponentAction 使用
          newTable.currentPosition = villain.position;
          pendingOpponentTableRef.current = { tableIndex, table: structuredClone(newTable) };
        }
        return newTable;

      } else if (action === 'call') {
        const callAmount = Math.min(amount || (newTable.currentBet - hero.currentBet), hero.stack);
        hero.stack -= callAmount;
        hero.currentBet += callAmount;
        newTable.pot += callAmount;

        currentHistory?.actions.push(createHistoryAction(newTable, {
          position: hero.position,
          type: 'call',
          amount: callAmount,
          potAfter: newTable.pot,
        }));

        // Bets matched — advance to next street
        advanceToNextStreet(newTable, hero, villain, tableIndex);
        return newTable;

      } else if (action === 'bet') {
        const totalBet = Math.max(
          FRONTEND_TABLE_CONFIG.minimumBetSizeBb,
          amount || FRONTEND_TABLE_CONFIG.minimumBetSizeBb,
        );
        const increase = totalBet - hero.currentBet;
        hero.stack -= increase;
        hero.currentBet = totalBet;
        newTable.pot += increase;
        newTable.currentBet = totalBet;
        newTable.lastRaiseSize = totalBet;

        currentHistory?.actions.push(createHistoryAction(newTable, {
          position: hero.position,
          type: 'bet',
          amount: totalBet,
          potAfter: newTable.pot,
        }));

        newTable.currentPosition = villain.position;
        pendingOpponentTableRef.current = { tableIndex, table: structuredClone(newTable) };
        return newTable;

      } else if (action === 'raise') {
        const totalRaise = Math.max(
          FRONTEND_TABLE_CONFIG.minimumBetSizeBb,
          amount || FRONTEND_TABLE_CONFIG.minimumBetSizeBb,
        );
        const increase = totalRaise - hero.currentBet;
        hero.stack -= increase;
        hero.currentBet = totalRaise;
        newTable.pot += increase;
        const raiseIncrease = hero.currentBet - newTable.currentBet;
        newTable.lastRaiseSize = Math.max(newTable.lastRaiseSize, raiseIncrease);
        newTable.currentBet = totalRaise;

        currentHistory?.actions.push(createHistoryAction(newTable, {
          position: hero.position,
          type: 'raise',
          amount: totalRaise,
          potAfter: newTable.pot,
        }));

        newTable.currentPosition = villain.position;
        pendingOpponentTableRef.current = { tableIndex, table: structuredClone(newTable) };
        return newTable;

      } else if (action === 'allin') {
        const allinAmount = hero.stack;
        hero.currentBet += allinAmount;
        hero.stack = 0;
        newTable.pot += allinAmount;

        const heroIsRaising = hero.currentBet > newTable.currentBet;
        if (heroIsRaising) {
          // Hero is raising / betting all-in: villain needs to respond
          const raiseIncrease = hero.currentBet - newTable.currentBet;
          newTable.lastRaiseSize = Math.max(newTable.lastRaiseSize, raiseIncrease);
          newTable.currentBet = hero.currentBet;

          currentHistory?.actions.push(createHistoryAction(newTable, {
            position: hero.position,
            type: 'allin',
            amount: hero.currentBet,
            potAfter: newTable.pot,
          }));

          newTable.currentPosition = villain.position;
          pendingOpponentTableRef.current = { tableIndex, table: structuredClone(newTable) };
        } else {
          // Hero is calling villain's all-in (bets are now matched) → advance to next street / showdown
          currentHistory?.actions.push(createHistoryAction(newTable, {
            position: hero.position,
            type: 'allin',
            amount: hero.currentBet,
            potAfter: newTable.pot,
          }));

          advanceToNextStreet(newTable, hero, villain, tableIndex);
        }
        return newTable;
      }

      return newTable;
    }));

    // Schedule opponent action，优先使用 pending 的完整 table 避免 path 不完整
    // 稍长 delay 确保 pre-solve（尤其 river）有足够时间完成
    setTimeout(() => {
      const p = pendingOpponentTableRef.current;
      if (p && p.tableIndex === tableIndex) {
        processOpponentAction(tableIndex, p.table);
        pendingOpponentTableRef.current = null;
      } else {
        processOpponentAction(tableIndex);
      }
    }, FRONTEND_TABLE_CONFIG.delayedOpponentActionMs);
  }, []);

  // ─── Opponent Action ───────────────────────────────────────────────────

  const processOpponentAction = useCallback(async (tableIndex: number, tableOverride?: GameState) => {
    // 优先使用传入的完整 table（含 hero 刚做的 action），避免 ref 未同步导致 path 不完整
    const tableToAct = tableOverride ?? latestTablesRef.current[tableIndex];
    if (!tableToAct || tableToAct.phase !== 'playing') return;

    const villainInfo = tableToAct.players.find(p => !p.isHero && p.isActive && !p.hasFolded);
    const heroInfo = tableToAct.players.find(p => p.isHero);

    if (!villainInfo || !heroInfo || tableToAct.currentPosition !== villainInfo.position) {
      return; // Abort
    }


    // Attempt GTO AI Backend
    const boardCards = tableToAct.communityCards.map(c => `${c.rank}${c.suit[0]}`).join(',');

    // Construct Path from history
    let path: string[] = buildGtoPath(tableToAct.history);

    const villainHole = villainInfo.cards ? `${villainInfo.cards[0].rank}${villainInfo.cards[0].suit[0]}${villainInfo.cards[1].rank}${villainInfo.cards[1].suit[0]}` : '';

    let decision: OpponentDecision | null = null;
    let backendFallbackReason: string | null = null;
    const shouldUseRiverLLMExploit =
      enableRiverLLMExploitRef.current &&
      tableToAct.currentStreet === 'river' &&
      Boolean(villainHole);

    console.log(`[GTO] path: ${path.join(' -> ')}`);
    if (shouldUseRiverLLMExploit) {
      try {
        decision = await requestRiverLLMDecision(
          tableIndex,
          tableToAct,
          heroInfo,
          villainInfo,
          path,
          villainHole,
        );
      } catch (e) {
        backendFallbackReason = e instanceof Error ? e.message : 'river exploit request failed';
        if (backendFallbackReason === RIVER_EXPLOIT_STALE_REQUEST) {
          return;
        }
        console.warn('River LLM exploit failed, falling back to the baseline backend.');
      }
    }

    if (!decision) {
      try {
        const res = await fetch('/api/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            board: boardCards,
            path,
            hand: villainHole,
            effective_stack: Math.min(heroInfo.stack, villainInfo.stack),
            use_mdf: tableToAct.config.enableMDF || false,
            datasetSource: latestTestConfigRef.current.datasetSource
          })
        });

        if (res.ok) {
          const data = await res.json();
          if (data?.strategy) {
            console.log('[GTO] strategy:', data.strategy);
          }
          if (data && data.action) {
            // Parse action
            const parts = data.action.split(' ');
            const act = parts[0].toLowerCase();
            if (['fold', 'check', 'call', 'bet', 'raise', 'allin'].includes(act)) {
              decision = {
                action: act as Action['type'],
                decisionSource: typeof data.decision_source === 'string' ? data.decision_source : undefined,
                decisionDetail: typeof data.decision_detail === 'string' ? data.decision_detail : undefined,
              };
              if (parts.length > 1) {
                decision.amount = parseFloat(parts[1]);
              }
            }
          }

          if (shouldUseRiverLLMExploit && decision) {
            updateRiverExploitTrace(tableIndex, trace => ({
              ...trace,
              tableId: tableToAct.id,
              status: 'complete',
              action: data.action ?? trace.action,
              decisionSource: typeof data.decision_source === 'string' ? data.decision_source : trace.decisionSource,
              decisionDetail: typeof data.decision_detail === 'string' ? data.decision_detail : trace.decisionDetail,
              warning: trace.warning ?? 'River exploit fell back to the baseline backend decision.',
            }));
          }
        } else {
          backendFallbackReason = `HTTP ${res.status}`;
        }
      } catch (e) {
        backendFallbackReason = e instanceof Error ? e.message : 'request failed';
        console.warn('Backend AI failed or not reachable, falling back to random');
      }
    }

    // Fallback exactly as it was
    if (!decision) {
      const fallbackDecision = getOpponentAction(
        tableToAct.pot,
        tableToAct.currentBet,
        villainInfo.currentBet,
        villainInfo.stack
      );
      decision = {
        ...fallbackDecision,
        decisionSource: 'client_fallback_random',
        decisionDetail: backendFallbackReason
          ? `Backend was unavailable (${backendFallbackReason}). Used the built-in client fallback.`
          : 'Backend returned no action. Used the built-in client fallback.',
      };

      if (shouldUseRiverLLMExploit) {
        updateRiverExploitTrace(tableIndex, trace => ({
          ...trace,
          tableId: tableToAct.id,
          status: 'error',
          action: `${fallbackDecision.action}${fallbackDecision.amount ? ` ${fallbackDecision.amount}` : ''}`,
          decisionSource: 'client_fallback_random',
          decisionDetail: decision?.decisionDetail ?? trace.decisionDetail,
          warning: trace.warning ?? 'Both backend decision paths failed, so the client fallback was used.',
          error: backendFallbackReason ?? trace.error,
        }));
      }
    }

    const finalDecision = decision;

    // Now apply state update
    setTables(prev => prev.map((table, i) => {
      if (i !== tableIndex || table.phase !== 'playing') return table;
      // Re-verify it's still villain's turn
      const villain = table.players.find(p => !p.isHero && p.isActive && !p.hasFolded);
      const hero = table.players.find(p => p.isHero);
      if (!villain || !hero || table.currentPosition !== villain.position) return table;

      const newTable = structuredClone(table);
      const newVillain = newTable.players.find(p => !p.isHero && p.isActive && !p.hasFolded)!;
      const newHero = newTable.players.find(p => p.isHero)!;
      const currentHistory = newTable.history.find(h => h.street === newTable.currentStreet);

      const decisionApplied = finalDecision;

      if (decisionApplied.action === 'fold') {
        newVillain.hasFolded = true;
        newTable.currentPosition = null;
        newTable.phase = 'showdown';

        currentHistory?.actions.push(createHistoryAction(newTable, {
          position: newVillain.position,
          type: 'fold',
          potAfter: newTable.pot,
          decisionSource: decisionApplied.decisionSource,
          decisionDetail: decisionApplied.decisionDetail,
        }));

        // Hero wins
        const heroInvested = (newTable.config.stackDepthBB - 2.5) - newHero.stack;
        const heroProfit = newTable.pot - heroInvested;
        newTable.showdownResult = {
          winnerId: newHero.position,
          heroHandRank: '-',
          villainHandRank: '-',
          potWon: newTable.pot,
          heroProfit,
        };

        if (newHero.cards) {
          saveHandToHistory(
            newTable.id, newHero.position, newHero.cards, newVillain.position,
            newTable.communityCards, newTable.pot, heroProfit,
            newTable.effectiveStack, newTable.history, user?.username || 'default'
          );
        }

      } else if (decisionApplied.action === 'check') {
        currentHistory?.actions.push(createHistoryAction(newTable, {
          position: newVillain.position,
          type: 'check',
          potAfter: newTable.pot,
          decisionSource: decisionApplied.decisionSource,
          decisionDetail: decisionApplied.decisionDetail,
        }));

        // Both checked — advance street
        const heroActedThisStreet = currentHistory?.actions.some(a => a.position === newHero.position) ?? false;
        if (heroActedThisStreet) {
          advanceToNextStreet(newTable, newHero, newVillain, tableIndex);
        } else {
          newTable.currentPosition = newHero.position;
        }

      } else if (decisionApplied.action === 'call') {
        const callAmount = decisionApplied.amount || (newTable.currentBet - newVillain.currentBet);
        newVillain.stack -= callAmount;
        newVillain.currentBet += callAmount;
        newTable.pot += callAmount;

        currentHistory?.actions.push(createHistoryAction(newTable, {
          position: newVillain.position,
          type: 'call',
          amount: callAmount,
          potAfter: newTable.pot,
          decisionSource: decisionApplied.decisionSource,
          decisionDetail: decisionApplied.decisionDetail,
        }));

        // Bets matched — advance street
        advanceToNextStreet(newTable, newHero, newVillain, tableIndex);

      } else if (decisionApplied.action === 'bet') {
        const totalBet = decisionApplied.amount || 1;
        const increase = totalBet - newVillain.currentBet;
        newVillain.stack -= increase;
        newVillain.currentBet = totalBet;
        newTable.pot += increase;
        newTable.currentBet = totalBet;
        newTable.lastRaiseSize = totalBet;

        currentHistory?.actions.push(createHistoryAction(newTable, {
          position: newVillain.position,
          type: 'bet',
          amount: totalBet,
          potAfter: newTable.pot,
          decisionSource: decisionApplied.decisionSource,
          decisionDetail: decisionApplied.decisionDetail,
        }));

        newTable.currentPosition = newHero.position;

      } else if (decisionApplied.action === 'raise') {
        const totalRaise = decisionApplied.amount || 1;
        const increase = totalRaise - newVillain.currentBet;
        newVillain.stack -= increase;
        newVillain.currentBet = totalRaise;
        newTable.pot += increase;
        const raiseIncrease = newVillain.currentBet - newTable.currentBet;
        newTable.lastRaiseSize = Math.max(newTable.lastRaiseSize, raiseIncrease);
        newTable.currentBet = totalRaise;

        currentHistory?.actions.push(createHistoryAction(newTable, {
          position: newVillain.position,
          type: 'raise',
          amount: totalRaise,
          potAfter: newTable.pot,
          decisionSource: decisionApplied.decisionSource,
          decisionDetail: decisionApplied.decisionDetail,
        }));

        newTable.currentPosition = newHero.position;

      } else if (decisionApplied.action === 'allin') {
        const allinAmount = newVillain.stack;
        newVillain.currentBet += allinAmount;
        newVillain.stack = 0;
        newTable.pot += allinAmount;

        if (newVillain.currentBet > newTable.currentBet) {
          const raiseIncrease = newVillain.currentBet - newTable.currentBet;
          newTable.lastRaiseSize = Math.max(newTable.lastRaiseSize, raiseIncrease);
          newTable.currentBet = newVillain.currentBet;
        }

        currentHistory?.actions.push(createHistoryAction(newTable, {
          position: newVillain.position,
          type: 'allin',
          amount: newVillain.currentBet,
          potAfter: newTable.pot,
          decisionSource: decisionApplied.decisionSource,
          decisionDetail: decisionApplied.decisionDetail,
        }));

        // If hero needs to act on the all-in
        const heroToCall = newVillain.currentBet - newHero.currentBet;
        if (heroToCall > 0) {
          newTable.currentPosition = newHero.position;
        } else {
          // Both are all-in or bets matched — run out remaining cards
          advanceToNextStreet(newTable, newHero, newVillain, tableIndex);
        }
      }

      return newTable;
    }));
  }, []);

  // ─── Advance Street Logic ─────────────────────────────────────────────

  function advanceToNextStreet(table: GameState, hero: Player, villain: Player, tableIndex?: number) {
    // Reset per-street bets
    hero.currentBet = 0;
    villain.currentBet = 0;
    table.currentBet = 0;
    table.lastRaiseSize = 0;

    // Both all-in? Run out all remaining streets
    const bothAllin = hero.stack === 0 && villain.stack === 0;
    const oneAllin = hero.stack === 0 || villain.stack === 0;

    const nextStreet = advanceStreet(table.currentStreet);

    if (!nextStreet) {
      // Showdown
      table.phase = 'showdown';
      table.currentPosition = null;
      table.showdownResult = resolveShowdown(table);

      if (hero.cards) {
        saveHandToHistory(
          table.id, hero.position, hero.cards, villain.position,
          table.communityCards, table.pot, table.showdownResult.heroProfit,
          table.effectiveStack, table.history, user?.username || 'default'
        );
      }
      return;
    }

    // Deal community cards
    table.currentStreet = nextStreet;
    const { cards, remaining } = getCardsForStreet(nextStreet, table.deck);
    table.communityCards = [...table.communityCards, ...cards];
    table.deck = remaining;

    // Add new street history
    table.history.push({
      street: nextStreet,
      cards,
      potBefore: table.pot,
      actions: [],
    });

    if (bothAllin || oneAllin) {
      // Run out remaining streets automatically
      advanceToNextStreet(table, hero, villain, tableIndex);
    } else {
      // OOP (first to act) is hero if heroActsFirst !== false, otherwise villain
      const oopPlayer = table.config.heroActsFirst !== false ? hero : villain;
      table.currentPosition = oopPlayer.position;
      // Flop→Turn / Turn→River 时立即触发 pre-solve，不依赖 useEffect 减少延迟
      if ((nextStreet === 'turn' || nextStreet === 'river') && tableIndex !== undefined) {
        triggerPreSolve(tableIndex, table);
      }
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────

  const visibleTables = tables.slice(0, tableCount);
  const isSingleView = tableCount === FRONTEND_TABLE_CONFIG.supportedTableCounts[0];

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Top Bar */}
      <div className="h-14 border-b border-[#333333] flex items-center justify-between px-4">
        <div className="text-sm text-gray-400">
          {isSingleView
            ? tables[0].phase === 'idle'
              ? 'Ready'
              : `Hand #${tables[0].handNumber} — ${tables[0].currentStreet.toUpperCase()}`
            : `${tableCount} TABLES`}
        </div>

        <div className="flex items-center gap-3">
          {/* Table Count Selector */}
          <div className="flex items-center gap-1 bg-[#1a1a1a] rounded p-1">
            {FRONTEND_TABLE_CONFIG.supportedTableCounts.map((count) => (
              <button
                key={count}
                onClick={() => setTableCount(count)}
                className={cn(
                  'px-3 py-1 rounded transition-colors font-semibold text-sm',
                  tableCount === count ? 'bg-[#00d084] text-black' : 'hover:bg-white/5 text-gray-400'
                )}
              >
                {count}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowHandHistory(true)}
            className="p-2 hover:bg-white/5 rounded transition-colors"
            title="手牌历史"
          >
            <History className="w-5 h-5" />
          </button>

          <button
            onClick={() => setShowSettings(true)}
            className="p-2 hover:bg-white/5 rounded transition-colors text-gray-400 hover:text-white"
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>

          <div className="w-px h-6 bg-[#333333] mx-1" />

          <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-[#1a1a1a] border border-[#333333]">
            <User className="w-4 h-4 text-[#00d084]" />
            <span className="text-xs font-medium text-gray-300 pr-1">{user?.username}</span>
            <button
              onClick={() => setShowLogoutConfirm(true)}
              className="p-1.5 hover:bg-white/10 rounded-full transition-colors text-gray-500 hover:text-red-400"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>

          {/* Leave button when playing */}
          {isSingleView && tables[0].phase === 'playing' && (
            <Button
              onClick={() => handleLeave(0)}
              variant="outline"
              size="sm"
              className="border-[#333333] hover:bg-white/5 text-gray-300 gap-2"
            >
              <LogOut className="w-4 h-4" />
              Leave
            </Button>
          )}

        </div>
      </div>

      {/* Main Game Area */}
      <div className="h-[calc(100vh-56px)]">
        {isSingleView ? (
          <TableView
            gameState={visibleTables[0]}
            isActive={true}
            tableNumber={1}
            isSingleView={true}
            quickBetSizes={quickBetSizes}
            showOpponentCards={showOpponentCards}
            showFaceUpOpponentCards={showFaceUpOpponentCards}
            showAIDecisionNotes={showAIDecisionNotes}
            showRiverExploitSidebar={enableRiverLLMExploit || riverExploitTraces[0].status !== 'idle'}
            riverExploitTrace={riverExploitTraces[0]}
            onAction={(action, amount) => handleAction(0, action, amount)}
            onStartNew={() => handleStartNew(0)}
            onRepeatHand={() => handleRepeatHand(0)}
            onLeave={() => handleLeave(0)}
            onNextHand={() => handleNextHand(0)}
          />
        ) : (
          <div className={cn(
            'grid h-full',
            tableCount === 2 && 'grid-cols-2',
            tableCount === 3 && 'grid-cols-2',
            tableCount === 4 && 'grid-cols-2 grid-rows-2'
          )}>
            {visibleTables.map((table, index) => (
              <TableView
                key={index}
                gameState={table}
                isActive={index === activeTable}
                tableNumber={index + 1}
                isSingleView={false}
                quickBetSizes={quickBetSizes}
                showOpponentCards={showOpponentCards}
                showFaceUpOpponentCards={showFaceUpOpponentCards}
                showAIDecisionNotes={showAIDecisionNotes}
                showRiverExploitSidebar={false}
                riverExploitTrace={riverExploitTraces[index] ?? createEmptyRiverExploitTrace()}
                onAction={(action, amount) => handleAction(index, action, amount)}
                onStartNew={() => handleStartNew(index)}
                onRepeatHand={() => handleRepeatHand(index)}
                onLeave={() => handleLeave(index)}
                onNextHand={() => handleNextHand(index)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Dialogs */}
      <HandHistoryDrawer
        isOpen={showHandHistory}
        onClose={() => setShowHandHistory(false)}
      />

      <SettingsDialog
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        quickBetSizes={quickBetSizes}
        onQuickBetSizesChange={(sizes) => {
          setQuickBetSizes(sizes);
          const key = user ? quickBetSizesKey(user.username) : FRONTEND_STORAGE_CONFIG.quickBetSizesStorePrefix;
          localStorage.setItem(key, JSON.stringify(sizes));
        }}
        testConfig={testConfig}
        onTestConfigChange={(config) => {
          const normalizedConfig = normalizeTestConfig(config);
          setTestConfig(normalizedConfig);
          const key = user ? testConfigKey(user.username) : FRONTEND_STORAGE_CONFIG.testConfigStorePrefix;
          localStorage.setItem(key, JSON.stringify(normalizedConfig));
        }}
      />

      {/* Logout Confirmation Dialog */}
      <AlertDialog open={showLogoutConfirm} onOpenChange={setShowLogoutConfirm}>
        <AlertDialogContent className="bg-[#0a0a0a] border-[#333333] text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Logout</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              Are you sure you want to log out?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#333333] hover:bg-white/5 text-gray-300">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowLogoutConfirm(false);
                logout();
              }}
              className="bg-[#d04040] hover:bg-[#d04040]/90 text-white"
            >
              Log Out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CustomHandDialog
        isOpen={showCustomHandDialog}
        onClose={() => {
          setShowCustomHandDialog(false);
          setCustomHandTableIndex(null);
        }}
        onConfirm={handleCustomHandConfirm}
        heroPosition={testConfig.heroPosition}
        villainPosition={testConfig.villainPosition}
        customHoleCards={testConfig.customHoleCards}
        datasetSource={testConfig.datasetSource}
      />
    </div>
  );
}
