import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Download, TrendingUp, TrendingDown } from 'lucide-react';
import type { HandRecord } from '@/types/poker';
import { useAuth } from '@/contexts/AuthContext';
import { handHistoryKey } from '@/lib/auth';
import { FRONTEND_STORAGE_CONFIG } from '@/config/frontend-config';

interface HandHistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface HandStats {
  totalHands: number;
  totalWon: number;
  totalLost: number;
  totalFolded: number;
  netProfit: number;
  winRate: number;
}

export function HandHistoryDrawer({ isOpen, onClose }: HandHistoryDrawerProps) {
  const { user } = useAuth();
  const [stats, setStats] = useState<HandStats>({
    totalHands: 0,
    totalWon: 0,
    totalLost: 0,
    totalFolded: 0,
    netProfit: 0,
    winRate: 0,
  });

  useEffect(() => {
    if (isOpen) {
      // Load hand history from localStorage scoped to user
      const key = user ? handHistoryKey(user.username) : FRONTEND_STORAGE_CONFIG.handHistoryStorePrefix;
      const stored = localStorage.getItem(key);
      if (stored) {
        const hands: HandRecord[] = JSON.parse(stored);

        const won = hands.filter(h => h.result > 0).length;
        const lost = hands.filter(h => h.result < 0).length;
        const folded = hands.filter(h => h.result === 0).length;
        const netProfit = hands.reduce((sum, h) => sum + h.result, 0);
        const winRate = hands.length > 0 ? (won / hands.length) * 100 : 0;

        setStats({
          totalHands: hands.length,
          totalWon: won,
          totalLost: lost,
          totalFolded: folded,
          netProfit,
          winRate,
        });
      }
    }
  }, [isOpen]);

  const handleExport = () => {
    const key = user ? handHistoryKey(user.username) : FRONTEND_STORAGE_CONFIG.handHistoryStorePrefix;
    const stored = localStorage.getItem(key);
    if (!stored) {
      alert('没有手牌历史数据');
      return;
    }

    const hands: HandRecord[] = JSON.parse(stored);

    // Generate Hand2Note format
    let hand2noteContent = '';

    hands.forEach((hand) => {
      const date = new Date(hand.timestamp);
      const dateStr = date.toISOString().split('T')[0].replace(/-/g, '/');
      const timeStr = date.toTimeString().split(' ')[0];

      // Hand header
      hand2noteContent += `PokerStars Hand #${hand.id}: Hold'em No Limit (${hand.effectiveStack}bb) - ${dateStr} ${timeStr}\n`;
      hand2noteContent += `Table '${hand.gameType}' 6-max Seat #1 is the button\n`;

      // Seat info
      hand2noteContent += `Seat 1: UTG (${hand.effectiveStack} bb)\n`;
      hand2noteContent += `Seat 2: HJ (${hand.effectiveStack} bb)\n`;
      hand2noteContent += `Seat 3: CO (${hand.effectiveStack} bb)\n`;
      hand2noteContent += `Seat 4: BTN (${hand.effectiveStack} bb)\n`;
      hand2noteContent += `Seat 5: SB (${hand.effectiveStack} bb)\n`;
      hand2noteContent += `Seat 6: BB (${hand.effectiveStack} bb)\n`;

      // Blinds
      hand2noteContent += `SB: posts small blind 0.5 bb\n`;
      hand2noteContent += `BB: posts big blind 1 bb\n`;

      // Hole cards
      const heroCard1 = `${hand.holeCards[0].rank}${hand.holeCards[0].suit[0]}`;
      const heroCard2 = `${hand.holeCards[1].rank}${hand.holeCards[1].suit[0]}`;
      hand2noteContent += `*** HOLE CARDS ***\n`;
      hand2noteContent += `Dealt to ${hand.position} [${heroCard1} ${heroCard2}]\n`;

      // Actions for each street
      hand.history.forEach((street) => {
        if (street.street === 'preflop') {
          hand2noteContent += `*** PREFLOP ***\n`;
        } else if (street.street === 'flop') {
          const flop = street.cards?.slice(0, 3).map(c => `${c.rank}${c.suit[0]}`).join(' ') || '';
          hand2noteContent += `*** FLOP *** [${flop}]\n`;
        } else if (street.street === 'turn') {
          const turn = street.cards?.[3];
          hand2noteContent += `*** TURN *** [${turn?.rank}${turn?.suit[0]}]\n`;
        } else if (street.street === 'river') {
          const river = street.cards?.[4];
          hand2noteContent += `*** RIVER *** [${river?.rank}${river?.suit[0]}]\n`;
        }

        street.actions.forEach((action) => {
          if (action.type === 'fold') {
            hand2noteContent += `${action.position}: folds\n`;
          } else if (action.type === 'check') {
            hand2noteContent += `${action.position}: checks\n`;
          } else if (action.type === 'call') {
            hand2noteContent += `${action.position}: calls ${action.amount} bb\n`;
          } else if (action.type === 'bet') {
            hand2noteContent += `${action.position}: bets ${action.amount} bb\n`;
          } else if (action.type === 'raise') {
            hand2noteContent += `${action.position}: raises ${action.amount} bb\n`;
          }
        });
      });

      // Summary
      hand2noteContent += `*** SUMMARY ***\n`;
      hand2noteContent += `Total pot ${hand.finalPot} bb\n`;

      if (hand.board.length > 0) {
        const boardStr = hand.board.map(c => `${c.rank}${c.suit[0]}`).join(' ');
        hand2noteContent += `Board [${boardStr}]\n`;
      }

      if (hand.result > 0) {
        hand2noteContent += `${hand.position}: won ${hand.result} bb\n`;
      } else if (hand.result < 0) {
        hand2noteContent += `${hand.position}: lost ${Math.abs(hand.result)} bb\n`;
      } else {
        hand2noteContent += `${hand.position}: folded\n`;
      }

      hand2noteContent += `\n\n`;
    });

    // Download file
    const blob = new Blob([hand2noteContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `poker_hands_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-[#0a0a0a] border-[#333333] text-white max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">手牌历史</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-6">
          {/* Total Hands */}
          <div className="text-center">
            <div className="text-6xl font-bold text-[#00d084]">
              {stats.totalHands}
            </div>
            <div className="text-lg text-gray-400 mt-2">
              总手牌数
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-4">
            {/* Win Rate */}
            <div className="bg-[#1a1a1a] border border-[#333333] rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-400">胜率</span>
                <TrendingUp className="w-4 h-4 text-[#00d084]" />
              </div>
              <div className="text-3xl font-bold text-[#00d084]">
                {stats.winRate.toFixed(1)}%
              </div>
            </div>

            {/* Net Profit */}
            <div className="bg-[#1a1a1a] border border-[#333333] rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-400">净盈利</span>
                {stats.netProfit >= 0 ? (
                  <TrendingUp className="w-4 h-4 text-[#00d084]" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-[#d04040]" />
                )}
              </div>
              <div className={`text-3xl font-bold ${stats.netProfit >= 0 ? 'text-[#00d084]' : 'text-[#d04040]'}`}>
                {stats.netProfit >= 0 ? '+' : ''}{stats.netProfit.toFixed(1)} bb
              </div>
            </div>

            {/* Won Hands */}
            <div className="bg-[#1a1a1a] border border-[#333333] rounded-lg p-4">
              <div className="text-sm text-gray-400 mb-2">获胜手牌</div>
              <div className="text-2xl font-bold text-[#00d084]">
                {stats.totalWon}
              </div>
            </div>

            {/* Lost Hands */}
            <div className="bg-[#1a1a1a] border border-[#333333] rounded-lg p-4">
              <div className="text-sm text-gray-400 mb-2">失败手牌</div>
              <div className="text-2xl font-bold text-[#d04040]">
                {stats.totalLost}
              </div>
            </div>

            {/* Folded Hands */}
            <div className="bg-[#1a1a1a] border border-[#333333] rounded-lg p-4 col-span-2">
              <div className="text-sm text-gray-400 mb-2">弃牌手数</div>
              <div className="text-2xl font-bold text-gray-500">
                {stats.totalFolded}
              </div>
            </div>
          </div>

          {/* Export Button */}
          <div className="border-t border-[#333333] pt-6">
            <Button
              onClick={handleExport}
              disabled={stats.totalHands === 0}
              className="w-full bg-[#00d084] hover:bg-[#00d084]/90 text-black font-semibold h-12"
            >
              <Download className="w-5 h-5 mr-2" />
              导出为 Hand2Note 格式
            </Button>
            <p className="text-xs text-gray-500 text-center mt-3">
              导出的文件可以直接导入到 Hand2Note 进行分析
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-4 border-t border-[#333333]">
          <Button
            onClick={onClose}
            variant="outline"
            className="border-[#333333] hover:bg-white/5"
          >
            关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
