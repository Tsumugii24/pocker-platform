# Poker Platform

这是一个用于德州扑克对战与 GTO 策略查询的测试平台。项目当前包含两套对手决策逻辑：

- 正常路径：优先走后端 GTO 查询，按当前手牌在求解树中的混合策略采样动作。
- 兜底路径：当后端不可用、查询失败或未返回有效动作时，前端退回启发式策略，保证对局可以继续。

## 对手决策设计

### 1. 正常 GTO 查询策略

前端在 `client/src/pages/GameTable.tsx` 中由 `processOpponentAction()` 驱动对手动作决策，整体流程如下：

1. 从当前牌局状态构造查询上下文：
   - `board`：当前公共牌，格式如 `Ac,Kd,7h`
   - `path`：从翻牌圈开始的动作路径；`CHECK`、`CALL` 直接记录，`BET/RAISE/ALLIN` 带金额，转牌和河牌发牌记录为 `DEAL:xx`
   - `hand`：对手真实手牌，例如 `AsKh`
   - `effective_stack`：双方剩余有效筹码
   - `use_mdf`：是否启用面向大额下注/加注的 MDF 防守逻辑

2. 前端调用后端 `POST /api/action`，由 `ai/app.py` 处理查询。

3. 后端先按翻牌三张公共牌定位对应的 Parquet 求解结果：
   - 优先读取本地 `ai/gto/cache/<flop>.parquet`
   - 若本地不存在，则尝试从 HuggingFace 或镜像自动下载

4. 后端加载配置与求解树后，按前端传入的 `path` 逐步回放当前牌局：
   - 在 `action_node` 中匹配动作
   - 在 `chance_node` 中处理 `DEAL:xx`
   - 若从 flop 进入 turn、或从 turn 进入 river，且目标街结果尚未存在，则导出对应配置并触发 solver 补算，再继续查询

5. 到达当前动作节点后，后端从该节点取出：
   - `actions`：当前可选动作集合
   - `strategy.strategy`：每个手牌对应的动作概率
   - `evs.evs`：每个动作的 EV

6. 后端用 `interactive_strategy.py` 中的 `_get_probs_for_hand()` 读取该手牌的概率向量，再用 `_sample_action_by_probs()` 按概率采样动作。

7. 若当前手牌在策略表中缺失，后端会退一步随机挑选一个代理手牌读取策略；若仍无法得到合法概率向量，则返回一个保守默认值 `check`。

8. 在面对下注/加注时，后端还会做两层额外修正：
   - 过滤不合法的加注动作，避免返回超出当前节点语义的 raise
   - 若前端启用了 `use_mdf`，且下注尺度达到阈值，则用 MDF 逻辑在 `fold` 与防守动作之间做一次覆盖式决策

9. 最终动作若超过剩余有效筹码，后端会把下注/加注金额裁剪到剩余筹码上限，再返回：
   - `action`：最终动作
   - `strategy`：该节点原始混合策略，便于调试

这一路径的设计目标是：只要求解树存在且查询成功，就尽量遵循求解器输出的混合策略，而不是使用固定规则硬编码动作。

### 2. Street 预求解机制

为了减少 turn/river 首次查询时的等待，前端在街切换前会额外发送一次“预热查询”：

- 请求仍然走 `/api/action`
- 但 `hand` 传空字符串，仅用于让后端提前走到下一街并触发必要的 solver 计算
- 后端会返回 `pre_solve: true` 表示这是一次预求解/预热请求，而不是实际出手决策

这样正式轮到对手行动时，下一街的求解结果更可能已经准备好。

### 3. 启发式兜底策略

当 `processOpponentAction()` 无法从后端拿到有效动作时，会调用 `client/src/lib/game-engine.ts` 中的 `getOpponentAction()`。该策略不看牌力，也不读取 GTO 数据，只依赖底池、当前下注和剩余筹码做随机决策。

#### 触发条件

以下任一情况成立时会进入兜底：

- 后端请求失败，例如服务未启动、网络异常、接口报错
- 后端返回成功但没有有效的 `action`
- 前端无法把后端返回值解析成 `fold/check/call/bet/raise/allin` 中的合法动作

#### 决策规则

先计算：

- `toCall = currentBet - opponentCurrentBet`

然后按状态决策：

1. 若 `opponentStack <= 0`
   - `toCall > 0` 时返回 `fold`
   - 否则返回 `check`

2. 若 `toCall === 0`，说明当前无人下注
   - 45% 概率 `check`
   - 55% 概率 `bet`
   - `bet` 金额为底池的 33% 到 100%，并四舍五入到 0.5BB
   - 若下注金额大于等于剩余筹码，则直接改为 `allin`

3. 若 `toCall > 0`，说明当前面临下注
   - 当 `toCall >= opponentStack` 时：
     - 30% 概率 `fold`
     - 70% 概率 `allin`
   - 当 `toCall < opponentStack` 时：
     - 20% 概率 `fold`
     - 50% 概率 `call`
     - 30% 概率 `raise`

4. `raise` 的尺寸规则
   - 加注目标总额约为当前下注额的 2.5x 到 3.5x
   - 金额同样按 0.5BB 取整
   - 若目标加注超过可用筹码，则改为 `allin`

这套兜底逻辑的设计目标不是逼近 GTO，而是在后端不可用时提供一套稳定、可继续对局的最小可用 AI，避免界面卡死或对局中断。

## 关键实现位置

- 前端动作请求与兜底切换：`client/src/pages/GameTable.tsx`
- 启发式兜底策略：`client/src/lib/game-engine.ts`
- GTO 查询入口：`ai/app.py`
- 手牌概率读取与采样：`ai/gto/interactive_strategy.py`

## 当前设计边界

- 启发式兜底策略不使用牌力、范围收缩或街面纹理信息，因此只能视为可用性保障，不应视为策略基线。
- 正常 GTO 路径依赖本地缓存或远端 Parquet 数据，以及 turn/river 的动态补算结果；这些资源不可用时会退回兜底。
- 后端即使在 GTO 路径中，也保留了若干工程化保护逻辑，例如代理手牌、非法 raise 过滤、金额封顶和可选 MDF 覆盖，以提高线上对战的稳定性。
