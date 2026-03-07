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
import type { GameState, Player, StreetHistory, TestConfig, ShowdownResult, Card } from '@/types/poker';
import { DEFAULT_TEST_CONFIG } from '@/types/poker';
import { formatBB, getScenarioLabel } from '@/lib/poker-utils';
import { generateHoleCards } from '@/lib/range-utils';
import {
  createSRPGame,
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
import { Settings, History, LogOut, Play, User, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getPlayerSeats, getSeatPosition } from '@/lib/position-utils';
import { useAuth } from '@/contexts/AuthContext';
import { handHistoryKey, quickBetSizesKey, testConfigKey } from '@/lib/auth';

// ─── TableView Component ─────────────────────────────────────────────────────

interface TableViewProps {
  gameState: GameState;
  isActive: boolean;
  tableNumber: number;
  isSingleView: boolean;
  quickBetSizes: number[];
  onAction: (action: 'check' | 'fold' | 'call' | 'bet' | 'raise' | 'allin', amount?: number) => void;
  onStartNew: () => void;
  onRepeatHand: () => void;
  onLeave: () => void;
}

function TableView({
  gameState,
  isActive,
  tableNumber,
  isSingleView,
  quickBetSizes,
  onAction,
  onStartNew,
  onRepeatHand,
  onLeave,
}: TableViewProps) {
  const [selectedBet, setSelectedBet] = useState(gameState.pot * 0.5 || 1);
  const [customBetInput, setCustomBetInput] = useState('');
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  const heroPlayer = gameState.players.find(p => p.isHero);
  const villainPlayer = gameState.players.find(p => !p.isHero && p.isActive && !p.hasFolded);
  const pot = gameState.pot;
  const currentBet = gameState.currentBet;
  const isHeroTurn = gameState.currentPosition === heroPlayer?.position;
  const phase = gameState.phase;

  // Map players to visual seats
  const playerSeats = getPlayerSeats(gameState.players);

  // Action availability
  const heroCurrentBet = heroPlayer?.currentBet ?? 0;
  const toCall = currentBet - heroCurrentBet;
  const canCheck = isHeroTurn && toCall === 0;
  const canCall = isHeroTurn && toCall > 0;
  const canBet = isHeroTurn && currentBet === 0;
  const canRaise = isHeroTurn && currentBet > 0;
  const canFold = isHeroTurn && toCall > 0;
  const heroStack = heroPlayer?.stack ?? 0;
  const canAllin = isHeroTurn && heroStack > 0;

  // Min bet = 1bb, min raise = current bet + last raise size (at least 1bb more)
  const minBet = 1;
  const minRaiseTotal = currentBet + Math.max(gameState.lastRaiseSize, 1);
  const minRaiseAmount = minRaiseTotal - heroCurrentBet;

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

  // ─── Idle View ───────────────────────────────────────────────────────────

  if (phase === 'idle') {
    return (
      <div className={cn('flex flex-col', !isSingleView && 'border-r border-b border-[#333333]')}>
        {!isSingleView && (
          <div className="h-8 border-b border-[#333333] flex items-center justify-between px-3">
            <div className="text-xs text-gray-500">Table {tableNumber}</div>
          </div>
        )}
        <div className={cn(
          'relative flex items-center justify-center',
          isSingleView ? 'h-[600px] p-8' : 'h-[360px] p-6'
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
    );
  }

  // ─── Showdown View ───────────────────────────────────────────────────────

  if (phase === 'showdown') {
    const result = gameState.showdownResult;
    const heroWon = result?.winnerId === heroPlayer?.position;
    const isSplit = result?.winnerId === null;

    return (
      <div className={cn('flex flex-col', !isSingleView && 'border-r border-b border-[#333333]')}>
        {!isSingleView && (
          <div className="h-8 border-b border-[#333333] flex items-center justify-between px-3">
            <div className="text-xs text-gray-500">Table {tableNumber}</div>
            <div className="text-xs text-gray-400">Hand #{gameState.handNumber}</div>
          </div>
        )}
        <div className={cn(
          'relative flex items-center justify-center',
          isSingleView ? 'h-[600px] p-8' : 'h-[360px] p-6'
        )}>
          <div className="relative w-full h-full border border-[#333333]" style={{ borderRadius: '50%' }}>
            {/* Center: result */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2">
              <div className={cn('text-gray-400', isSingleView ? 'text-xs' : 'text-[10px]')}>
                {getScenarioLabel(gameState.config)}
              </div>

              <div className={cn('font-bold flex items-center gap-2', isSingleView ? 'text-3xl' : 'text-xl')}>
                Pot: {formatBB(pot)}
                <ActionHistoryPopover history={gameState.history} isSingleView={isSingleView} />
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
              const showCards = (isHero || (player.isActive && !player.hasFolded)) && player.cards;
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
    );
  }

  // ─── Playing View ────────────────────────────────────────────────────────

  return (
    <div className={cn('flex flex-col', !isSingleView && 'border-r border-b border-[#333333]')}>
      {/* Table Header (multi-table only) */}
      {!isSingleView && (
        <div className="h-8 border-b border-[#333333] flex items-center justify-between px-3">
          <div className="text-xs text-gray-500">Table {tableNumber}</div>
          <div className="flex items-center gap-2">
            <div className="text-xs text-gray-400">Hand #{gameState.handNumber}</div>
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
        isSingleView ? 'h-[600px] p-8' : 'h-[360px] p-6'
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
              <ActionHistoryPopover history={gameState.history} isSingleView={isSingleView} />
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

            return (
              <div key={player.position} className="absolute" style={position}>
                <div className={cn('flex flex-col items-center', gap)}>
                  <PlayerPosition player={player} size={isSingleView ? undefined : 'small'} />
                  {isHero && player.cards ? (
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
    </div>
  );
}

// ─── Main GameTable Component ────────────────────────────────────────────────

export default function GameTable() {
  const { user, logout } = useAuth();
  const [tableCount, setTableCount] = useState(1);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [testConfig, setTestConfig] = useState<TestConfig>(() => {
    const key = user ? testConfigKey(user.username) : 'poker_test_config';
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : DEFAULT_TEST_CONFIG;
  });
  const [tables, setTables] = useState<GameState[]>(() => {
    return [1, 2, 3, 4].map(i => createIdleTable(0, testConfig));
  });
  const [activeTable, setActiveTable] = useState(0);
  const [quickBetSizes, setQuickBetSizes] = useState<number[]>(() => {
    const key = user ? quickBetSizesKey(user.username) : 'poker_quick_bet_sizes';
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [33, 50, 75, 100, 125, 150, 175, 200];
  });
  const [showHandHistory, setShowHandHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCustomHandDialog, setShowCustomHandDialog] = useState(false);
  const [customHandTableIndex, setCustomHandTableIndex] = useState<number | null>(null);

  const latestTablesRef = useRef(tables);
  const prevStreetsRef = useRef<string[]>([]);

  useEffect(() => {
    latestTablesRef.current = tables;

    // Eager Solving/Pre-solve trigger
    tables.forEach((table, i) => {
      const streetKey = `${table.id}_${table.currentStreet}_${table.communityCards.length}`;
      if (prevStreetsRef.current[i] !== streetKey && table.phase === 'playing') {
        const villain = table.players.find(p => !p.isHero);
        // If it's NOT the AI's turn, but a new card just dropped, notify backend to start solving
        if (villain && table.currentPosition !== villain.position) {
          triggerPreSolve(i);
        }
      }
      prevStreetsRef.current[i] = streetKey;
    });
  }, [tables]);

  const triggerPreSolve = useCallback(async (tableIndex: number) => {
    const table = latestTablesRef.current[tableIndex];
    if (!table || table.phase !== 'playing') return;

    const boardCards = table.communityCards.map(c => `${c.rank}${c.suit[0]}`).join(',');
    const villain = table.players.find(p => !p.isHero);
    const hero = table.players.find(p => p.isHero);
    if (!villain || !hero) return;

    let path: string[] = [];
    table.history.forEach(round => {
      if (round.street === 'preflop') return;
      if (round.street === 'turn' || round.street === 'river') {
        const cardGot = round.cards?.[0];
        if (cardGot) path.push(`DEAL:${cardGot.rank}${cardGot.suit[0]}`);
      }
      round.actions.forEach(a => {
        if (a.type === 'bet' || a.type === 'raise' || a.type === 'allin') {
          path.push(`${a.type.toUpperCase()} ${a.amount}`);
        } else {
          path.push(a.type.toUpperCase());
        }
      });
    });

    console.log(`[Pre-solve] Triggering for table ${tableIndex}, path: ${path.join(' -> ')}`);
    try {
      await fetch('http://127.0.0.1:5000/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          board: boardCards,
          path,
          hand: '', // Hand doesn't matter for pre-solving street transition
          effective_stack: Math.min(hero.stack, villain.stack)
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
      return createSRPGame(table.handNumber, testConfig, table.initialDeck);
    }));
  }, [testConfig]);

  // ─── Leave Table ───────────────────────────────────────────────────────

  const handleLeave = useCallback((tableIndex: number) => {
    setTables(prev => prev.map((table, i) => {
      if (i !== tableIndex) return table;
      return createIdleTable(table.handNumber, testConfig);
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

        currentHistory?.actions.push({
          position: hero.position,
          type: 'fold',
          potAfter: newTable.pot,
          timestamp: new Date(),
        });

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
        currentHistory?.actions.push({
          position: hero.position,
          type: 'check',
          potAfter: newTable.pot,
          timestamp: new Date(),
        });

        // Check if betting round should end (both players checked / bet matched)
        // If hero checks and villain hasn't acted yet this street, villain's turn
        // If hero checks after villain checked, advance street
        const villainActedThisStreet = currentHistory?.actions.some(a => a.position === villain.position) ?? false;

        if (villainActedThisStreet) {
          // Both checked — advance street
          advanceToNextStreet(newTable, hero, villain);
        } else {
          // Villain's turn
          newTable.currentPosition = villain.position;
        }
        return newTable;

      } else if (action === 'call') {
        const callAmount = Math.min(amount || (newTable.currentBet - hero.currentBet), hero.stack);
        hero.stack -= callAmount;
        hero.currentBet += callAmount;
        newTable.pot += callAmount;

        currentHistory?.actions.push({
          position: hero.position,
          type: 'call',
          amount: callAmount,
          potAfter: newTable.pot,
          timestamp: new Date(),
        });

        // Bets matched — advance to next street
        advanceToNextStreet(newTable, hero, villain);
        return newTable;

      } else if (action === 'bet') {
        const betAmount = Math.max(1, amount || 1);
        hero.stack -= betAmount;
        hero.currentBet += betAmount;
        newTable.pot += betAmount;
        newTable.currentBet = hero.currentBet;
        newTable.lastRaiseSize = betAmount;

        currentHistory?.actions.push({
          position: hero.position,
          type: 'bet',
          amount: betAmount,
          potAfter: newTable.pot,
          timestamp: new Date(),
        });

        newTable.currentPosition = villain.position;
        return newTable;

      } else if (action === 'raise') {
        const raiseAmount = Math.max(1, amount || 1);
        hero.stack -= raiseAmount;
        hero.currentBet += raiseAmount;
        newTable.pot += raiseAmount;
        const raiseIncrease = hero.currentBet - newTable.currentBet;
        newTable.lastRaiseSize = Math.max(newTable.lastRaiseSize, raiseIncrease);
        newTable.currentBet = hero.currentBet;

        currentHistory?.actions.push({
          position: hero.position,
          type: 'raise',
          amount: hero.currentBet,
          potAfter: newTable.pot,
          timestamp: new Date(),
        });

        newTable.currentPosition = villain.position;
        return newTable;

      } else if (action === 'allin') {
        const allinAmount = hero.stack;
        hero.currentBet += allinAmount;
        hero.stack = 0;
        newTable.pot += allinAmount;
        if (hero.currentBet > newTable.currentBet) {
          const raiseIncrease = hero.currentBet - newTable.currentBet;
          newTable.lastRaiseSize = Math.max(newTable.lastRaiseSize, raiseIncrease);
          newTable.currentBet = hero.currentBet;
        }

        currentHistory?.actions.push({
          position: hero.position,
          type: 'allin',
          amount: hero.currentBet,
          potAfter: newTable.pot,
          timestamp: new Date(),
        });

        newTable.currentPosition = villain.position;
        return newTable;
      }

      return newTable;
    }));

    // Schedule opponent action
    setTimeout(() => {
      processOpponentAction(tableIndex);
    }, 800);
  }, []);

  // ─── Opponent Action ───────────────────────────────────────────────────

  const processOpponentAction = useCallback(async (tableIndex: number) => {
    // We cannot reliably get state using setTables asynchronously, so we use a ref.
    const tableToAct = latestTablesRef.current[tableIndex];
    if (!tableToAct || tableToAct.phase !== 'playing') return;

    const villainInfo = tableToAct.players.find(p => !p.isHero && p.isActive && !p.hasFolded);
    const heroInfo = tableToAct.players.find(p => p.isHero);

    if (!villainInfo || !heroInfo || tableToAct.currentPosition !== villainInfo.position) {
      return; // Abort
    }


    // Attempt GTO AI Backend
    const boardCards = tableToAct.communityCards.map(c => `${c.rank}${c.suit[0]}`).join(',');

    // Construct Path from history
    let path: string[] = [];
    tableToAct.history.forEach(round => {
      // Except preflop!
      if (round.street === 'preflop') return;

      if (round.street === 'turn' || round.street === 'river') {
        const cardGot = round.cards?.[0];
        if (cardGot) {
          path.push(`DEAL:${cardGot.rank}${cardGot.suit[0]}`);
        }
      }

      round.actions.forEach(a => {
        if (a.type === 'bet' || a.type === 'raise') {
          path.push(`${a.type.toUpperCase()} ${a.amount}`);
        } else if (a.type === 'allin') {
          // GTO maps all in to an amount usually or "ALLIN"
          path.push(`ALLIN ${a.amount}`);
        } else {
          path.push(a.type.toUpperCase());
        }
      });
    });

    const villainHole = villainInfo.cards ? `${villainInfo.cards[0].rank}${villainInfo.cards[0].suit[0]}${villainInfo.cards[1].rank}${villainInfo.cards[1].suit[0]}` : '';

    let decision: { action: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin'; amount?: number } | null = null;

    try {
      const res = await fetch('http://127.0.0.1:5000/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          board: boardCards,
          path,
          hand: villainHole,
          effective_stack: Math.min(heroInfo.stack, villainInfo.stack)
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.action) {
          // Parse action
          const parts = data.action.split(' ');
          const act = parts[0].toLowerCase();
          if (['fold', 'check', 'call', 'bet', 'raise', 'allin'].includes(act)) {
            decision = { action: act as any };
            if (parts.length > 1) {
              decision.amount = parseFloat(parts[1]);
            }
          }
        }
      }
    } catch (e) {
      console.warn('Backend AI failed or not reachable, falling back to random');
    }

    // Fallback exactly as it was
    if (!decision) {
      decision = getOpponentAction(
        tableToAct.pot,
        tableToAct.currentBet,
        villainInfo.currentBet,
        villainInfo.stack
      );
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

        currentHistory?.actions.push({
          position: newVillain.position,
          type: 'fold',
          potAfter: newTable.pot,
          timestamp: new Date(),
        });

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
        currentHistory?.actions.push({
          position: newVillain.position,
          type: 'check',
          potAfter: newTable.pot,
          timestamp: new Date(),
        });

        // Both checked — advance street
        const heroActedThisStreet = currentHistory?.actions.some(a => a.position === newHero.position) ?? false;
        if (heroActedThisStreet) {
          advanceToNextStreet(newTable, newHero, newVillain);
        } else {
          newTable.currentPosition = newHero.position;
        }

      } else if (decisionApplied.action === 'call') {
        const callAmount = decisionApplied.amount || (newTable.currentBet - newVillain.currentBet);
        newVillain.stack -= callAmount;
        newVillain.currentBet += callAmount;
        newTable.pot += callAmount;

        currentHistory?.actions.push({
          position: newVillain.position,
          type: 'call',
          amount: callAmount,
          potAfter: newTable.pot,
          timestamp: new Date(),
        });

        // Bets matched — advance street
        advanceToNextStreet(newTable, newHero, newVillain);

      } else if (decisionApplied.action === 'bet') {
        const betAmount = decisionApplied.amount || 1;
        newVillain.stack -= betAmount;
        newVillain.currentBet += betAmount;
        newTable.pot += betAmount;
        newTable.currentBet = newVillain.currentBet;
        newTable.lastRaiseSize = betAmount;

        currentHistory?.actions.push({
          position: newVillain.position,
          type: 'bet',
          amount: betAmount,
          potAfter: newTable.pot,
          timestamp: new Date(),
        });

        newTable.currentPosition = newHero.position;

      } else if (decisionApplied.action === 'raise') {
        const raiseAmount = decisionApplied.amount || 1;
        newVillain.stack -= raiseAmount;
        newVillain.currentBet += raiseAmount;
        newTable.pot += raiseAmount;
        const raiseIncrease = newVillain.currentBet - newTable.currentBet;
        newTable.lastRaiseSize = Math.max(newTable.lastRaiseSize, raiseIncrease);
        newTable.currentBet = newVillain.currentBet;

        currentHistory?.actions.push({
          position: newVillain.position,
          type: 'raise',
          amount: newVillain.currentBet,
          potAfter: newTable.pot,
          timestamp: new Date(),
        });

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

        currentHistory?.actions.push({
          position: newVillain.position,
          type: 'allin',
          amount: newVillain.currentBet,
          potAfter: newTable.pot,
          timestamp: new Date(),
        });

        // If hero needs to act on the all-in
        const heroToCall = newVillain.currentBet - newHero.currentBet;
        if (heroToCall > 0) {
          newTable.currentPosition = newHero.position;
        } else {
          // Both are all-in or bets matched — run out remaining cards
          advanceToNextStreet(newTable, newHero, newVillain);
        }
      }

      return newTable;
    }));
  }, []);

  // ─── Advance Street Logic ─────────────────────────────────────────────

  function advanceToNextStreet(table: GameState, hero: Player, villain: Player) {
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
      advanceToNextStreet(table, hero, villain);
    } else {
      // OOP (BB) acts first
      table.currentPosition = hero.position; // hero = BB = OOP
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────

  const visibleTables = tables.slice(0, tableCount);
  const isSingleView = tableCount === 1;

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
            {[1, 2, 3, 4].map((count) => (
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
            onAction={(action, amount) => handleAction(0, action, amount)}
            onStartNew={() => handleStartNew(0)}
            onRepeatHand={() => handleRepeatHand(0)}
            onLeave={() => handleLeave(0)}
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
                onAction={(action, amount) => handleAction(index, action, amount)}
                onStartNew={() => handleStartNew(index)}
                onRepeatHand={() => handleRepeatHand(index)}
                onLeave={() => handleLeave(index)}
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
        onQuickBetSizesChange={setQuickBetSizes}
        testConfig={testConfig}
        onTestConfigChange={(config) => {
          setTestConfig(config);
          const key = user ? testConfigKey(user.username) : 'poker_test_config';
          localStorage.setItem(key, JSON.stringify(config));
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
      />
    </div>
  );
}
