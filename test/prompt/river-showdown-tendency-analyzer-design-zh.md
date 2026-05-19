# River Showdown Tendency Analyzer 设计

## 目标

构建一套低样本玩家专用的 river showdown 倾向分析系统。它用于分析那些整体 showdown 数量较少、无法依赖稳定 stat 频率判断的玩家。

系统默认扫描目标玩家最近 30 天内在 H2N 中可见的 river showdown 手牌，读取完整行动线、牌面、玩家手牌、river 实际动作和下注尺度，并调用 GTO API 查询该节点中这手牌的标准策略分布。系统根据玩家实际行动与 GTO 行动频率的偏离，生成近期倾向假设和剥削建议。

这套系统不是替代 stat 分析。若玩家样本足够，仍优先使用 H2N stat 频率与 GTO 基准对比；本系统只用于 showdown 有限、但每一手摊牌都可能暴露策略倾向的场景。

## 范围

第一版包含：

- 目标玩家单人分析。
- 默认最近 30 天，可配置时间范围。
- 只分析 river 决策节点。
- 只使用有 showdown 且可见目标玩家手牌的手牌。
- 优先分析 heads-up pot。
- 支持 SRP、3BP、4BP 的结构字段，但第一版可先从 SRP/常见 heads-up spot 开始。
- GTO API 返回可比较的策略分布，系统自己判断偏离和倾向；具体协议和字段由后续 API 实现决定。

第一版不包含：

- 实时桌上提示。
- 多街完整 solver 复盘。
- 根据 fold 手牌判断过紧，因为通常看不到 fold 后手牌。
- 全部玩家全局自动扫描。
- 用少量 showdown 直接推翻长期稳定 stat。

## 核心原则

1. River showdown 是低样本玩家的证据，不是强结论。
2. 每一手牌先转成一条结构化证据，再由同方向证据合并成倾向。
3. GTO API 只提供策略分布，不直接决定玩家倾向。
4. 行动频率是第一版主要偏离标准，EV 作为可选辅助。
5. 如果近期证据与长期 H2N stat 冲突，标记为近期策略漂移候选，而不是立刻覆盖旧模型。

## 输入数据

输入层以 H2N 的原始 hand history / 手牌记录格式为准，不要求用户或 H2N 导出端先转换成系统自定义 JSON。系统需要做的是读取 H2N 当前能提供的完整手牌记录，并在内部解析出分析所需信息。

为了方便后续实现，系统内部统一使用一份“接近 H2N 手牌记录语义”的 JSON。它不是要求 H2N 必须原生导出这种格式，而是要求读取层把 H2N 原始手牌记录完整映射进来，尽量不要提前丢失信息。

建议输入 JSON：

```json
{
  "source": {
    "provider": "H2N",
    "database": "Z200玩家池数据",
    "imported_at": "2026-05-18T20:00:00+08:00",
    "raw_format": "h2n_hand_history",
    "raw_record": "H2N 原始手牌文本或原始结构化记录"
  },
  "hand": {
    "hand_id": "string",
    "played_at": "2026-05-18T19:42:31+08:00",
    "game_type": "NLH",
    "table_type": "6max",
    "currency": "CNY",
    "stakes": {
      "small_blind": 1,
      "big_blind": 2,
      "ante": 0
    },
    "table": {
      "name": "string",
      "max_seats": 6,
      "players_dealt": 6
    },
    "seats": [
      {
        "seat_no": 1,
        "nickname": "PlayerA",
        "position": "BTN",
        "stack_bb": 100,
        "is_target_player": true,
        "hole_cards": ["Ah", "5h"],
        "cards_visible": true
      },
      {
        "seat_no": 2,
        "nickname": "PlayerB",
        "position": "BB",
        "stack_bb": 100,
        "is_target_player": false,
        "hole_cards": null,
        "cards_visible": false
      }
    ],
    "target_player": {
      "nickname": "PlayerA",
      "seat_no": 1,
      "position": "BTN",
      "hole_cards": ["Ah", "5h"]
    },
    "board": {
      "flop": ["Kh", "7h", "2c"],
      "turn": "9s",
      "river": "3d"
    },
    "pot": {
      "pot_type": "SRP",
      "is_heads_up_after_flop": true,
      "effective_stack_bb": 100,
      "final_pot_bb": 42.5
    },
    "streets": {
      "preflop": {
        "pot_before_street_bb": 1.5,
        "actions": [
          {
            "order": 1,
            "player": "PlayerA",
            "position": "BTN",
            "action": "raise",
            "amount_bb": 2.5,
            "size_type": "open"
          },
          {
            "order": 2,
            "player": "PlayerB",
            "position": "BB",
            "action": "call",
            "amount_bb": 1.5
          }
        ]
      },
      "flop": {
        "board": ["Kh", "7h", "2c"],
        "pot_before_street_bb": 5.5,
        "actions": [
          {
            "order": 1,
            "player": "PlayerB",
            "position": "BB",
            "action": "check"
          },
          {
            "order": 2,
            "player": "PlayerA",
            "position": "BTN",
            "action": "bet",
            "amount_bb": 1.8,
            "size_pot_pct": 33
          },
          {
            "order": 3,
            "player": "PlayerB",
            "position": "BB",
            "action": "call",
            "amount_bb": 1.8
          }
        ]
      },
      "turn": {
        "board": ["Kh", "7h", "2c", "9s"],
        "pot_before_street_bb": 9.1,
        "actions": [
          {
            "order": 1,
            "player": "PlayerB",
            "position": "BB",
            "action": "check"
          },
          {
            "order": 2,
            "player": "PlayerA",
            "position": "BTN",
            "action": "check"
          }
        ]
      },
      "river": {
        "board": ["Kh", "7h", "2c", "9s", "3d"],
        "pot_before_street_bb": 9.1,
        "actions": [
          {
            "order": 1,
            "player": "PlayerB",
            "position": "BB",
            "action": "check"
          },
          {
            "order": 2,
            "player": "PlayerA",
            "position": "BTN",
            "action": "bet",
            "amount_bb": 12.3,
            "size_pot_pct": 135,
            "is_target_decision": true
          },
          {
            "order": 3,
            "player": "PlayerB",
            "position": "BB",
            "action": "call",
            "amount_bb": 12.3
          }
        ]
      }
    },
    "showdown": {
      "went_to_showdown": true,
      "shown_hands": [
        {
          "player": "PlayerA",
          "position": "BTN",
          "hole_cards": ["Ah", "5h"],
          "hand_class": "missed draw",
          "hand_strength_text": "ace high",
          "is_target_player": true
        },
        {
          "player": "PlayerB",
          "position": "BB",
          "hole_cards": ["Kc", "Qd"],
          "hand_class": "top pair",
          "hand_strength_text": "pair of kings",
          "is_target_player": false
        }
      ],
      "winner": "PlayerB",
      "target_player_showed": true
    }
  }
}
```

字段设计原则：

- `source.raw_record` 保留 H2N 原始手牌记录，方便解析失败时回看。
- `seats` 保留整桌玩家和座位信息，避免只看目标玩家导致位置判断错误。
- `streets` 按 H2N 手牌历史的自然顺序保存每条街动作。
- 每个 action 保留 `order`、`player`、`position`、`action`、`amount_bb`、`size_pot_pct`。
- river 中目标玩家的关键动作可以标记 `is_target_decision: true`。
- `showdown.shown_hands` 只记录实际可见手牌；看不到的手牌用 `cards_visible: false` 或不写入。
- `raw_record` 和结构化字段都保留；如果二者冲突，优先回到 H2N 原始记录人工检查。

系统内部可以从 H2N 原始记录中派生标准字段，例如：

- river 决策节点。
- river 实际动作。
- river 下注尺度。
- 目标玩家摊牌牌力类别。
- 底池类型。
- 是否 heads-up。
- 是否可进入 GTO 对比。

这些派生字段只属于分析器内部结构，不要求 H2N 输入数据提前符合它们。如果某手牌无法稳定识别 river 节点，系统保留 H2N 原始记录，但不用于倾向置信度提升。

## GTO API 边界

GTO API 的具体请求方式和返回 JSON 格式第一版设计文档中不固定。后续由制作 GTO API 的程序根据 solver 数据结构决定。

本系统只要求 GTO API 最终能支持一个能力：给定当前牌面、目标玩家手牌、位置、有效后手、底池类型和完整行动线，返回该 river 节点中这手牌的可行动作及其频率。若 API 能额外返回 EV、最佳动作、size 分布或 blocker/hand-class 解释，系统可以作为辅助信息使用。

因此，本模块与 GTO API 的关系是：

- 分析器负责从 H2N 原始手牌中识别需要查询的 river 节点。
- GTO API 负责理解该节点并返回 solver 策略信息。
- 分析器负责把玩家实际行动与 GTO 策略结果进行对比。
- API 的字段名、协议和内部查询方式不在本 spec 中约束。

## 偏离判断

系统先把玩家实际行动映射到 GTO action bucket：

- `check`
- `bet small`
- `bet medium`
- `bet big`
- `bet overbet`
- `call`
- `raise`

第一版频率阈值：

- `0% - 5%`：强偏离
- `5% - 15%`：中等偏离
- `15% - 30%`：轻微偏离
- `30%+`：不作为明显偏离

如果 EV 可用：

- 低频且 EV 明显低于最佳动作：提高证据强度。
- 低频但 EV 接近最佳动作：标记为策略偏好不同，降低证据强度。
- 高频动作即使结果异常，也不作为玩家偏离证据。

## 倾向分类

第一版输出三大类 river 倾向。

### River bluff 倾向

可能证据：

- GTO 高频 check，玩家用 busted draw 或弱牌 bet。
- GTO 某个大 size 极低频，玩家使用该大 size bluff。
- 多手摊牌显示玩家在相似节点用低 showdown value 手牌下注。

可能结论：

- river 过度 bluff
- river 极化大注 bluff 偏多
- river bluff 不足

### River thin value 倾向

可能证据：

- GTO 高频 bet，玩家拿 strong value check。
- GTO 高频使用更大 size，玩家持续使用小 size。
- GTO 高频 check，玩家拿 marginal made hand bet。

可能结论：

- value extraction 不足
- thin value 不足
- thin value 过多
- size 偏小或极化不足

### River bluffcatch 倾向

可能证据：

- GTO 高频 fold，玩家 call 并摊牌。
- GTO 混合 call/fold，玩家多次偏向 call。
- 玩家用低 blocker 质量或弱 showdown value 高频 bluffcatch。

可能结论：

- bluffcatch 过宽
- bluffcatch 接近正常
- bluffcatch 倾向不足，第一版只能在有摊牌 call 证据时弱判断，不能通过看不到手牌的 fold 强判断。

## 证据对象

每手牌分析后生成一条 evidence：

```json
{
  "hand_id": "string",
  "played_at": "2026-05-18T20:00:00+08:00",
  "player": "Ryan Gibson",
  "river_node": "BTN vs BB SRP river IP facing check",
  "actual_action": "bet",
  "actual_size_pot_pct": 125,
  "showdown_hand_class": "busted draw",
  "gto_action_frequency": 0.01,
  "gto_best_action": "check",
  "gto_best_frequency": 0.86,
  "deviation_level": "strong",
  "tendency_tags": [
    "river_overbluff",
    "polarized_size_overuse"
  ],
  "confidence_impact": "strong_support",
  "explanation": "该手牌在 GTO 中几乎纯 check，但玩家使用 125% pot 下注并摊牌为 missed draw。"
}
```

## 汇总逻辑

系统按玩家和时间窗口汇总 evidence：

- 最近 river showdown 总数。
- 成功映射到 GTO 的手牌数。
- 明显偏离证据数。
- 每个 tendency tag 的证据数。
- 强、中、轻微偏离的数量。
- 同方向证据是否集中在相似节点。
- 是否与长期 H2N stat 发生冲突。

倾向置信度建议：

- `weak`：1 条强证据，或 2 条轻中证据。
- `medium`：2 条以上强证据，或 3 条以上同方向证据。
- `strong`：5 条以上同方向证据，且节点/牌类解释一致。

低样本系统默认保守。即使出现强证据，也应描述为“近期倾向候选”，而不是绝对结论。

## 报告格式

报告输出第一版不固定模板，由 LLM 根据证据自由组织。目标是让报告读起来像一份牌手研究 summary，而不是机械表格。

报告至少应覆盖：

- 目标玩家。
- 时间范围。
- 最近 river showdown 手牌数量。
- 成功进入 GTO 对比的手牌数量。
- 关键偏离证据。
- 每条关键证据背后的行动线、摊牌手牌和 GTO 对比。
- 近期倾向假设。
- 置信度或证据强弱。
- 对应剥削建议。
- 后续需要继续观察的 spot。

LLM 可以根据证据强弱自行决定报告结构、措辞和详略。后续当实际报告样例足够多后，再把用户认可的表达方式固化成模板。

## 与现有系统的关系

当前项目已有动态监控模块：

- `src/monitor/evidence.js`
- `src/monitor/gto-client.js`
- `src/monitor/change-detector.js`
- `src/monitor/report.js`
- `src/monitor/state-store.js`

本系统可以复用这些模块，但需要增加一个专门的 river showdown 分析层：

- `river-showdown-reader`：从 H2N 读取最近 river showdown 手牌。
- `river-node-parser`：把 H2N 原始手牌记录中的完整行动线映射成 river 决策节点。
- `gto-strategy-normalizer`：把 GTO API 返回结果统一成 action bucket；具体 API 字段由后续 API 实现决定。
- `river-deviation-classifier`：根据频率和 EV 判断偏离强度。
- `tendency-aggregator`：把多条 evidence 合并成玩家倾向。
- `river-showdown-report`：生成低样本近期倾向 summary。

## 异常处理

- H2N 暂不可用：报告数据源不可用，不生成倾向。
- GTO API 不可用：保留原始 showdown 证据，状态标记为待 GTO 确认。
- 手牌无法解析成稳定节点：保留 raw hand，不参与置信度。
- 多人底池：第一版默认降权或跳过。
- 行动 size 无法匹配：映射到最近 size bucket，并在证据中标记。
- 玩家手牌不可见：不进入本系统。

## 验证标准

第一版应使用人工确认的样例验证：

1. GTO 几乎纯 check，玩家 busted draw river bet，系统标记为 strong overbluff evidence。
2. GTO 高频 bet，玩家 strong value check back，系统标记为 value extraction 不足。
3. GTO 高频 fold，玩家 bluffcatch call 并摊牌，系统标记为 bluffcatch 过宽候选。
4. GTO 混合策略中玩家选择低频但 EV 接近动作，系统只标记为轻微偏好，不生成强结论。
5. 无明显偏离的普通 showdown 不应生成倾向报告。

## 待实现前确认

实现前需要确认：

- H2N 中 river showdown hand history 的原始读取方式：直接读数据库、读取导出文件，还是由本地 app 传入。
- H2N 原始手牌记录里哪些字段能稳定表示玩家手牌、公共牌、行动线、下注 size 和 showdown。
- size bucket 的映射规则，例如 small、medium、big、overbet 的阈值。
- 是否第一版只支持 heads-up SRP，还是同时支持 3BP。
- 报告输出位置和是否接入现有 Windows 本地 app。
