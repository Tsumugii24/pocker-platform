import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import type { TestConfig } from '@/types/poker';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  quickBetSizes: number[];
  onQuickBetSizesChange: (sizes: number[]) => void;
  testConfig: TestConfig;
  onTestConfigChange: (config: TestConfig) => void;
}

export function SettingsDialog({
  isOpen,
  onClose,
  quickBetSizes,
  onQuickBetSizesChange,
  testConfig,
  onTestConfigChange,
}: SettingsDialogProps) {
  const [tempSizes, setTempSizes] = useState<number[]>(quickBetSizes);
  const [tempTestConfig, setTempTestConfig] = useState<TestConfig>(testConfig);

  useEffect(() => {
    setTempSizes(quickBetSizes);
    setTempTestConfig(testConfig);
  }, [quickBetSizes, testConfig, isOpen]);

  const handleSave = () => {
    onQuickBetSizesChange(tempSizes);
    localStorage.setItem('poker_quick_bet_sizes', JSON.stringify(tempSizes));
    onTestConfigChange(tempTestConfig);
    onClose();
  };

  const handleReset = () => {
    const defaultSizes = [33, 50, 75, 100, 125, 150, 175, 200];
    setTempSizes(defaultSizes);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-[#0a0a0a] border-[#333333] text-white max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">设置</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4 flex-1 overflow-y-auto pr-2">
          {/* Test Type Section */}
          <div>
            <h3 className="text-lg font-semibold mb-4">测试类型</h3>
            <p className="text-sm text-gray-400 mb-4">
              设置对战的场景和配置
            </p>

            <div className="space-y-4">
              {/* Matchup */}
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">对战位置</Label>
                  <p className="text-xs text-gray-500">当前仅支持 BB vs UTG</p>
                </div>
                <div className="bg-[#1a1a1a] border border-[#333333] rounded px-3 py-2 text-sm text-gray-300">
                  {tempTestConfig.heroPosition} vs {tempTestConfig.villainPosition}
                </div>
              </div>

              {/* Deal Mode */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-medium">发牌模式 (Start New)</Label>
                    <p className="text-xs text-gray-500">
                      {tempTestConfig.dealMode === 'custom' ? '手动选择翻牌 (Flop)' : '完全随机发牌'}
                    </p>
                  </div>
                  <select
                    value={tempTestConfig.dealMode || 'random'}
                    onChange={(e) => setTempTestConfig(prev => ({ ...prev, dealMode: e.target.value as 'random' | 'custom' }))}
                    className="bg-[#1a1a1a] border border-[#333333] rounded px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-[#00d084]"
                  >
                    <option value="random">Random (随机)</option>
                    <option value="custom">Custom (用户自选公共牌)</option>
                  </select>
                </div>
                {tempTestConfig.dealMode === 'custom' && (
                  <div className="flex items-center justify-between pl-4 border-l-2 border-[#333333] ml-1 mt-1">
                    <div>
                      <Label className="text-sm font-medium">手牌也自定义</Label>
                      <p className="text-xs text-gray-500">
                        如果不勾选，手牌 (Hole Cards) 将保持随机
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={!!tempTestConfig.customHoleCards}
                      onChange={(e) => setTempTestConfig(prev => ({ ...prev, customHoleCards: e.target.checked }))}
                      className="w-5 h-5 rounded bg-[#1a1a1a] border-[#333333] accent-[#00d084]"
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">Player Bluff (玩家允许诈唬)</Label>
                  <p className="text-xs text-gray-500">
                    关闭时将仅分配标准 GTO Preflop 范围内的手牌
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={tempTestConfig.allowPlayerBluff ?? true}
                  onChange={(e) => setTempTestConfig(prev => ({ ...prev, allowPlayerBluff: e.target.checked }))}
                  className="w-5 h-5 rounded bg-[#1a1a1a] border-[#333333] accent-[#00d084]"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">AI Bluff (AI允许诈唬)</Label>
                  <p className="text-xs text-gray-500">
                    关闭时将仅为 AI 分配标准 GTO Preflop 范围内的手牌
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={tempTestConfig.allowAIBluff ?? true}
                  onChange={(e) => setTempTestConfig(prev => ({ ...prev, allowAIBluff: e.target.checked }))}
                  className="w-5 h-5 rounded bg-[#1a1a1a] border-[#333333] accent-[#00d084]"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">MDF 防守机制 (Flop阶段)</Label>
                  <p className="text-xs text-gray-500">
                    开启时，面临较大尺寸下注/加注时，AI 会严格按底池比例 (MDF) 防守
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={!!tempTestConfig.enableMDF}
                  onChange={(e) => setTempTestConfig(prev => ({ ...prev, enableMDF: e.target.checked }))}
                  className="w-5 h-5 rounded bg-[#1a1a1a] border-[#333333] accent-[#00d084]"
                />
              </div>

              {/* Pot Type */}
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">底池类型</Label>
                  <p className="text-xs text-gray-500">当前仅支持单次加注底池 (SRP)</p>
                </div>
                <div className="bg-[#1a1a1a] border border-[#333333] rounded px-3 py-2 text-sm text-gray-300">
                  Single Raised Pot
                </div>
              </div>

              {/* Stack Depth */}
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">筹码深度</Label>
                  <p className="text-xs text-gray-500">每位玩家的起始筹码</p>
                </div>
                <div className="bg-[#1a1a1a] border border-[#333333] rounded px-3 py-2 text-sm text-gray-300">
                  {tempTestConfig.stackDepthBB} BB
                </div>
              </div>

              {/* Effective Stack */}
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">有效筹码</Label>
                  <p className="text-xs text-gray-500">Flop 阶段开始时的剩余筹码</p>
                </div>
                <div className="bg-[#1a1a1a] border border-[#333333] rounded px-3 py-2 text-sm text-[#00d084] font-semibold">
                  {tempTestConfig.stackDepthBB - 2.5} BB
                </div>
              </div>

              {/* Preflop Scenario Description */}
              <div className="bg-[#111] border border-[#333333] rounded-lg p-4 mt-2">
                <div className="text-xs text-gray-500 font-semibold mb-2">翻前场景</div>
                <div className="text-xs text-gray-400 space-y-1">
                  <p>• SB 发布 0.5BB, BB 发布 1BB</p>
                  <p>• UTG 加注到 2.5BB</p>
                  <p>• HJ, CO, BTN, SB 弃牌</p>
                  <p>• BB 跟注 → 底池 = 5.5BB</p>
                  <p>• 两位玩家各剩余 97.5BB</p>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Bet Buttons */}
          <div className="border-t border-[#333333] pt-6">
            <h3 className="text-lg font-semibold mb-4">快捷下注按钮（底池百分比）</h3>
            <p className="text-sm text-gray-400 mb-4">
              自定义 {tempSizes.length} 个快捷下注按钮的百分比值（相对于当前底池）
            </p>

            <div className="grid grid-cols-4 gap-4">
              {tempSizes.map((size, index) => (
                <div key={index} className="space-y-2">
                  <Label htmlFor={`bet-${index}`} className="text-sm text-gray-300">
                    按钮 {index + 1}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`bet-${index}`}
                      type="number"
                      step="1"
                      min="1"
                      max="500"
                      value={size}
                      onChange={(e) => {
                        const newSizes = [...tempSizes];
                        newSizes[index] = parseInt(e.target.value) || 0;
                        setTempSizes(newSizes);
                      }}
                      className="bg-[#1a1a1a] border-[#333333] text-white"
                    />
                    <span className="text-gray-400 text-sm">%</span>
                  </div>
                </div>
              ))}
            </div>

            <Button
              onClick={handleReset}
              variant="outline"
              size="sm"
              className="mt-4 border-[#333333] hover:bg-white/5"
            >
              恢复默认值 (33%, 50%, 75%, 100%, 125%, 150%, 175%, 200%)
            </Button>
          </div>

          {/* Betting Rules */}
          <div className="border-t border-[#333333] pt-6">
            <h3 className="text-lg font-semibold mb-4">游戏规则</h3>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">显示对手手牌</Label>
                  <p className="text-xs text-gray-500">摊牌时显示对手的手牌</p>
                </div>
                <input
                  type="checkbox"
                  defaultChecked
                  className="w-5 h-5 rounded bg-[#1a1a1a] border-[#333333]"
                />
              </div>

              <div className="border-t border-[#333333] pt-4 mt-4">
                <Label className="text-sm font-medium">下注规则</Label>
                <div className="mt-2 space-y-2 text-xs text-gray-400">
                  <p>• 最小下注：1 bb</p>
                  <p>• 最小加注：上次加注大小</p>
                  <p>• 快捷按钮：按底池百分比计算</p>
                  <p>• All-in：可随时全押剩余筹码</p>
                  <p>• 筹码为 0 时自动 All-in</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 pt-4 border-t border-[#333333] mt-2 shrink-0">
          <Button
            onClick={onClose}
            variant="outline"
            className="border-[#333333] hover:bg-white/5"
          >
            取消
          </Button>
          <Button
            onClick={handleSave}
            className="bg-[#00d084] hover:bg-[#00d084]/90 text-black font-semibold"
          >
            保存设置
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
