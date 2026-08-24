# Wiz-War 改造实施计划：规则强制 + 卡牌互动 + AI 对战

> 状态：**计划定稿，待 opencode/qwen3.8 实施**。本文档是唯一实施依据，实施者按里程碑顺序执行，
> 每个里程碑都要先写"当前会失败、修复后通过"的测试（红→绿），全部完成后 `npm run typecheck`、
> `npm run test`、`npm run build` 必须全绿。
>
> 规则基线：`DESIGN.md` §3/§10 + 每张卡的 `text` 字段（即卡面原文）。
> 卡牌精确行为一律以 `text` 为准；本文档只定引擎机制，不定卡牌文字。

---

## 0. 现状诊断（实施者先读）

当前 66 个单测全绿、typecheck 通过，但存在系统性缺口，按严重度排序：

### 0.1 规则强制缺口（`src/core/`）
| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| R1 | **跨扇区移动无视边界墙/门** | `board.ts` `moveDestination` 234-253 行 | 同扇区分支检查 `wallBetween`/门，但"走出扇区"分支只查传送门后直接 `toLocal`，**从不查边界墙/门**。`board-data.json` 中所有扇区内边界都有墙 → 巫师能直接从蓝色扇区东侧穿墙进红色扇区。 |
| R2 | **首回合攻击禁令只拦拳击** | `actions.ts` `doCast` 98 行 | `doPunch` 检查 `isFirstTurn`，`doCast` 不检查。首回合可施放攻击法术/武器。 |
| R3 | **门永不重锁** | `actions.ts`/`effects.ts` `pick-lock` | `locked=false; heldOpenBy=caster` 永久生效。规则：穿过即重锁，除非持有者相邻保持。 |
| R4 | **关着的门不挡 LOS** | `board.ts` `wallBlocksLOS` | 只查墙，不查门。规则：关着的门挡 LOS。 |
| R5 | **宝藏 VP 完全缺失** | `damage.ts`/`actions.ts` | 规则：敌方宝藏停在自己 home 格 → +1 VP，移走即失。当前唯一 VP 来源是杀敌。 |
| R6 | **无法攻击墙/门/物体** | `actions.ts` | `damageObject`（damage.ts:144）从未被调用。石墙 5 裂缝、门 3 裂缝规则不可触发。 |
| R7 | **手牌超限不强制弃牌** | `actions.ts`/`turn.ts` | 手牌上限 7（含携带物+维持法术），超限应立即弃到上限，未实现。 |
| R8 | **持续效果（time-passes）是空壳** | `damage.ts` `resolveTimePasses` | 只有能量递减+眩晕，没有 Acid Bath/Wall of Fire/Fire Clock/Slow Death/Fool's Gold 等的"每当时间流逝"伤害钩子。 |
| R9 | **眩晕语义过于简单** | `actions.ts` `notStunned` | 现在禁止移动/拳击/施法一切。规则：眩晕者只能移动或攻击（二选一），不能施法。 |
| R10 | **目标校验残缺** | `actions.ts` `validateTarget` | 只校验 wizard/cell 的 adjacent/los。door/wall/object/square/line 目标无任何校验。 |
| R11 | **"伤害=法术能量"被硬编码** | `effects.ts` `damage` | 15 张卡文字写"等于该法术能量"，effect 却写死 `amount`（如 Globe of Pain amount=2）。能量加速施法不提升伤害。 |
| R12 | **能量卡燃料逻辑不闭环** | `actions.ts` `doCast` | `energyCard` 参数存在但 AI/UI 从不传；Powerstone 加能量、Add 合并能量未实现。 |

### 0.2 卡牌互动缺口
| # | 问题 | 数据 | 说明 |
|---|---|---|---|
| C1 | **反制系统是死代码** | 4 张 `counter-spell` + 10 张 `shield` | `state.awaitingCounter` 从不出现在置位路径；`doCounter` 不取消任何东西。这是热座模式无法承载的"实时互动"。 |
| C2 | **35 张卡 `op:no-op`** | 见 §5.1 清单 | 静默无效果（应改为校验期拒绝或真实实现）。 |
| C3 | **28 张物品卡 `op:item`** | 见 §5.2 清单 | 武器/魔法石/造物全部无效。 |
| C4 | **bot 空放攻击法术** | `ai/bots.ts` `getLegalActions` | 只生成 `cast` 不带 `target`；`resolveTargets` 无目标返回 `[]` → 零伤害。RandomBot/EvolvingBot 的攻击全部空放，仅 HeuristicBot 带目标。 |

### 0.3 热座 → AI 对战
- 热座（`hotseat.ts` + `GameUI` 的 pass-device 覆盖层）本质无法支持回合中实时反制。
- `headless/sim.ts` 已有 AI vs AI 雏形，但外层循环与反制窗口不兼容。
- `core/ai/evolving.ts` `playMatch`（269 行）不跑真实对局，只做参数启发式比较 —— 进化是假的。
- 当前无"旁观/自动战斗" UI。

---

## 1. 目标与非目标

### 目标
1. 修复 0.1 全部规则强制缺口。
2. 修复 0.2 全部卡牌互动缺口：反制窗口可用；63 张无效果卡落地；能量规则正确；bot 会选目标。
3. 把热座模式替换为 **AI vs AI 自动对战模式**（旁观者仪表盘：看板+日志+速度控制+开局配置）。

### 非目标（明确不做）
- 网络对战、多人在线。
- 生物子系统完整版（Homunculus 例外：见 M5，最小实现或数据标注暂缓）。
- Malefic Curses / Bestial Forces 扩展（学派=数据，加扩展=加数据）。
- 回合中超过一层的反制链（Anti-Anti 链式反制）：v1 只支持单层反制窗口，Anti-Anti 作为扩展预留。
- 绕边（board-data 所有外边缘有墙且无传送门，实际不可绕边；见 §2.7 决策）。

---

## 2. 总体设计决策（实施者必须遵守）

### 2.1 核心保持同步纯函数，异步驱动独立成层
- `src/core/` 保持同步、确定性、可单测。**不得**把 `applyAction` 改 async。
- 新增 `src/headless/run-game.ts`（异步对局驱动）：驱动同步引擎 + 反制窗口 + 查询 AI。**无头 sim 与浏览器 UI 共用这一个驱动**（单一事实源）。
- 反制窗口实现：施法动作分两步 —— `cast`（校验+扣牌+置 `awaitingCast`）→ 反制窗口（驱动层询问合格 bot）→ `resolve-cast`（真正结算效果）。核心提供 `cast` 与 `resolve-cast` 两个同步动作，驱动层负责中间的问询。

### 2.2 反制窗口数据模型
`types.ts`：
```ts
// 替换 GameState.awaitingCounter: CastInfo | null
export interface AwaitingCast {
  caster: number;
  cardId: string;
  target: TargetRef | null;
  energy: number;              // 燃料结算后的最终能量
  counterOrder: number[];      // 可反制玩家 id，按座位顺序
  countered: boolean;
}
GameState.awaitingCast: AwaitingCast | null
```
新动作：
```ts
| { type: 'resolve-cast' }          // 反制窗口结束后结算
| { type: 'counter'; cardId: string }  // 反制（去掉原 spellIndex 参数）
```
CardDef 增加反制声明：
```ts
counter?: {
  blocks: CardType[];          // 可反制的施法类型，如 ['neutral-spell'] / ['attack-spell','neutral-spell','transform']
  requiresTargetingMe?: boolean; // true=仅当该法术目标是自己（Full Shield / Null Powder）
};
```
数据标注（M2 改卡数据）：
- `cantrip-negate-neutral` / `conjuring-negate-neutral` / `thaumaturgy-negate-neutral`：`counter.blocks=['neutral-spell']`
- `mutation-absorb-spell`：`counter.blocks=['attack-spell'], requiresTargetingMe:true`
- `cantrip-full-shield`（及 10 张 shield 卡，`op:shield`）：`counter.blocks=[任意], requiresTargetingMe:true`（shield 是反制形态，见 M3）
- `alchemy-null-powder`（物品）：携带时弃掉可当反制，`requiresTargetingMe:true`

合格反制者 = 存活、非施法者、手中持有一张 `counter` 与当前待反制法术匹配的卡。响应顺序 = `counterOrder`（从施法者下一座位开始，绕一圈）。

### 2.3 施法流程（重写 `doCast`）
```
cast action:
  1. 校验：当前回合/阶段/非眩晕/牌在手/目标合法（validateTarget 全类型）
  2. 首回合校验：若卡是攻击型（type==='attack-spell' || countsAsAttack）且 isFirstTurn → 拒绝
  3. 扣手牌（+燃料能量卡进弃牌堆）
  4. 结算能量：energy = card.energy + 燃料卡 energyValue（Powerstone 加成）
  5. 计算 counterOrder（合格反制者）
  6. 置 state.awaitingCast
  7. 返回 { ok:true, events:[cast, awaiting-counter] }   ← 不结算效果、不置 attacked
resolve-cast action:
  1. 读 awaitingCast；无则拒绝
  2. 若攻击型 → p.attacked = true
  3. resolveEffect(state, caster, card, target, energy)
  4. checkWin；清 awaitingCast
counter action:
  1. 校验 awaitingCast 存在、非施法者、牌在手且 counter 匹配
  2. 扣牌→弃牌堆；awaitingCast.countered=true；清 awaitingCast
  3. 返回事件（待反制法术作废：其卡已进弃牌堆，效果不结算，attacked 不置位）
```

### 2.4 统一对局驱动（`src/headless/run-game.ts`）
```ts
export interface BattleCallbacks {
  afterAction?(state: GameState): void | Promise<void>;  // UI 重渲染 + 延时
  onWinner?(state: GameState): void | Promise<void>;
}
export interface BattleConfig {
  seed: number;
  playerColors: Color[];
  botTypes: BotKind[];            // 'random' | 'heuristic' | 'evolving' | custom
  schools: School[];
  maxTurns?: number;              // 默认 500
  delayMs?: number;               // UI 用；headless 传 0
  callbacks?: BattleCallbacks;
}
export async function runBattle(
  state: GameState, bots: AIPlayer[], cfg: BattleConfig,
): Promise<{ winner: number | null; turns: number }>
```
主循环（替代 `sim.ts` 现有 while 循环与 `GameUI.playBotTurn`）：
```
while (winner===null && turns<maxTurns) {
  const cur = players[currentPlayer]
  startTurn(state); if (winner!==null || !cur.alive) continue
  let guard=0
  while (phase is move-cast|discard-draw && currentPlayer unchanged && guard++<MAX) {
    const legal = getLegalActions(state, cur.id)
    if (legal.length===0) { applyAction(end-turn); break }
    const action = await bot.chooseAction(state, legal)
    const res = applyAction(state, action)
    if (res.ok && state.awaitingCast) await runCounterWindow(state, bots, cur.id, cfg)
    await cfg.callbacks?.afterAction(state)
    if (res.ok && currentPlayer!==cur.id) break
    if (!res.ok && ++failCount>3) { applyAction(end-turn); break }  // 防死循环
  }
  turns++
}
```
`runCounterWindow`：对 `awaitingCast.counterOrder` 每个 bot 调 `chooseCounter`，命中即 `applyAction({type:'counter',cardId})` 并 break；否则全部通过后 `applyAction({type:'resolve-cast'})`。
`sim.ts` 重构为薄封装：`runBattle(state, bots, {delayMs:0, callbacks:...})`，返回结果 + `state.log`。旧 CLI 入口保留。

### 2.5 合法动作生成器是唯一事实源
`getLegalActions`（`ai/bots.ts`）升级为**面向动作的完整枚举**，同时供 AI 与 UI 用：
- `cast` 带目标：对每张可施法手牌，按 `card.range` × `card.target` 枚举合法目标（见 M3 §4.1）。
- `use-item` 带目标（武器/投掷物）。
- `counter`（在 `awaitingCast` 窗口期生成，见 M2）。
- `boost-speed`、`discard`、`draw`、`end-turn` 已有。
- 上限控制：每个目标类型枚举上限（如相邻或 LOS 内所有 wizard；door/wall/object 全枚举，量小）。

### 2.6 能量语义（修正 R11/R12）
- 法术基础能量 = `card.energy`；施法时可附加能量卡，最终 `energy = card.energy + Σfuel`（Powerstone 再 +1）。
- effect 节点支持 `"damage": "energy"`（字符串）或 `{ "amount": "@energy" }`，resolver 用传入的 `energy` 结算。把 15 张"伤害=能量"卡的 effect 改成 `{op:'damage', amount:'@energy', kind:'magical'}`（M2 批量改数据）。
- 其余 effect 里 `amount` 为数字的维持原样。
- `doBoostSpeed` 保留（每回合一次）；武器耗能走 `use-item`（M4）。

### 2.7 决策记录（实施者照做，不再猜）
1. **绕边不做**：board-data 外边缘全有墙且 portals=[]，移动出界即被挡为合理行为，与提取拓扑一致。DESIGN.md §3.3"绕边"该行视作被拓扑取代，不改代码。
2. **反制只做单层**：`awaitingCast` 窗口内，合格者依次表态一次；被反制后不开启第二层窗口（Anti-Anti 留数据位）。
3. **手牌上限含携带物+维持法术**（`handSize` 已实现），在 `end-turn` 进入下家前强制弃到上限（R7）。
4. **home 定义**：`Cell.kind==='home'` 的格子（每扇区 2×2 角区）。宝藏 VP 判定用该区域而非单格。
5. **眩晕规则**（R9）：眩晕者 `stunTokens>0` 时——可移动（≤1 MP）或攻击（二选一），**不可施法/用物品/拾取/加速**。实现为：`notStunned` 只拦施法/物品/拾取；移动改为最多 1 步；攻击允许一次。若与 `WizWar_v2.1.pdf` 有出入，以 PDF 为准（实施者可用读 PDF 核对 §Stun）。
6. **杀敌 VP 保留**：维持 DESIGN.md"直接攻击致死 +1 VP 并收手牌"，与宝藏 VP 并存。
7. **物品施法/武器攻击**：`use-item` 增加 `target` 与可选 `fuel`（Wizardblade 弃一张魔法卡）。投掷类武器（Large Rock/Boomstone/Universal Solvent）使用即消耗；武器攻击占用本回合攻击次数（置 `attacked`）。首回合同样禁止。

---

## 3. 里程碑总览

| # | 主题 | 依赖 | 主要文件 |
|---|---|---|---|
| M0 | 规则修正（棋盘/移动/LOS/门/首回合/眩晕/手牌/宝藏VP） | 无 | `board.ts` `damage.ts` `turn.ts` `actions.ts` `state.ts` `types.ts` |
| M1 | 反制窗口 + 统一对局驱动 | M0 | `types.ts` `actions.ts` 新 `headless/run-game.ts` `sim.ts` `ai/bots.ts` |
| M2 | 卡牌目标系统 + 能量规则 + 卡数据修正 | M0 | `actions.ts` `effects.ts` `ai/bots.ts` 卡 JSON |
| M3 | 持续效果系统（time-passes + 维持法术修饰） | M2 | `damage.ts` `effects.ts` `types.ts` |
| M4 | no-op 特殊法术落地（35 张） | M3 | `effects.ts` 卡 JSON |
| M5 | 物品/武器/造物系统（28 张 + 新动作） | M4 | `actions.ts` `effects.ts` `board.ts` |
| M6 | AI 对战 UI + 自进化 AI 真实对局 | M1 | `client/main.ts` `client/battle-ui.ts`(新) `headless/evolve.ts` `core/ai/evolving.ts` |
| M7 | 回归、稳定性、调参、文档 | 全部 | 全仓 |

每个里程碑结束时：`npm run typecheck` + `npm run test` 全绿；`npm run build` 通过（M6 起）。

---

## 4. M0 规则修正（先做，独立、收益最大）

### 4.1 R1 跨扇区移动边界检查 —— `src/core/board.ts`
`moveDestination` 走出扇区分支（234 行起）改为：
1. 先查传送门（现有逻辑，保留）。
2. 否则检查**边界墙**：从 `from` 沿 `dir` 出边界的墙，存在两边存储——即 `from` 格该方向的墙 或 对侧扇区对应格反向的墙。任一存在且非动态墙已毁 → 返回 null。
3. 检查**边界门**：`doorBetween` 只能查本扇区 `from` 侧；对侧扇区同边界格的反向门也要查（`board-data` 门存于单侧，实施时核对数据：用 `doorBetween(board, toLocal(gr,gc), OPPOSITE[dir])`）。
4. 门判定复用 `isDoorOpenFor(door, color)`；穿过即重锁逻辑见 4.3。
5. 越界（`gr<0...`）→ null，保持不变（决策 2.7.1）。

测试（当前红→修复后绿）：
```ts
// board.test.ts：给蓝色扇区 (0,4) 东侧设墙，移动东应失败；无墙时成功
// board.test.ts：边界门：蓝(0,4).doors.E 锁门，红色方通行需 isDoorOpenFor
```

### 4.2 R4 关着的门挡 LOS —— `board.ts` `wallBlocksLOS`
`wallBlocksLOS` 中除 `wallBetween` 外，追加"门阻断"检查：`from`/`to` 之间的门存在且 `!isDoorOpenFor(door, 观察者)` 时阻断。函数需能拿到观察者颜色（LOS 调用方传 `observerColor`）。`hasLOS` 签名改为 `hasLOS(board, from, to, observerColor?)`；effects/actions 调用处传施法者颜色。
测试：有窗关门的两个格子之间 LOS=false；开门后 LOS=true。

### 4.3 R3 门穿过即重锁 —— `board.ts` + `actions.ts`
- `actions.ts doMove`：移动成功后，若经过了某扇门（`from`→`to` 之间有门），应用重锁规则：门 `heldOpenBy` 为空或持有者移动后不再相邻 → `locked=true; heldOpenBy=null`；持有者相邻保持开。
- `effects.ts pick-lock`：`heldOpenBy=caster.id` 保留（表示"我要保持开门"）。
测试：穿过持有者已离开的门后 `locked===true`；持有者相邻时 `locked===false`。

### 4.4 R2 首回合攻击禁令统一 —— `actions.ts`
- `doCast`：`isFirstTurn` 且卡为攻击型（`type==='attack-spell' || countsAsAttack`）→ 拒绝（reason 含 `first turn`）。
- `doUseItem`（武器攻击，见 M5）：同样检查。
- 提取助手 `isAttackCard(card)` 供三处复用。
测试：turnNumber===1 时施放 `zot` 失败；turn 2 成功。

### 4.5 R9 眩晕规则 —— `actions.ts`
- `notStunned` 拆细：施法/用物品/拾取/加速 → 拦；移动/攻击 → 放行。
- `doMove`：`p.stunned` 时本回合移动上限 1（用 `p.stunned && p.mp` 截断：`p.mp = Math.min(p.mp, 1)` 在 startTurn 时对眩晕者生效；或 doMove 内判断 `p.stunned && movesThisTurn>=1` 拒绝。实现任选，行为一致即可）。
- `doPunch`：眩晕者仍可攻击一次（受 `attacked` 限制）。
- 注意 `turn.ts:28` `p.stunned = p.stunTokens > 0` 与 `resolveTimePasses` 的交互：保证"眩晕 token 在回合初减 1 后，若仍 >0 则本回合眩晕"。
测试：眩晕者施法失败、移动 1 步后第二次移动失败、可攻击。

### 4.6 R7 手牌超限强制弃牌 —— `turn.ts` + `actions.ts`
- `endTurn(state)`（进入下家前）与 `advancePlayer` 后：对每个玩家 `while (handSize(p) > MAX_HAND_SIZE) 强制弃一张`（优先弃手牌，其次维持法术/物品? —— 规则按玩家选择；v1 实现为自动弃手牌末尾）。
- `doDiscard` 在 discard-draw 阶段语义不变。
测试：手牌 8 结束回合后自动回到 ≤7。

### 4.7 R5 宝藏 VP —— `damage.ts` + `state.ts` + `types.ts`
- `state.ts createGameState`：放置宝藏时记录 `state.treasureHome: Record<number, Color>`（宝藏所在扇区颜色 = 归属）。`GameState` 加字段；`serialize/deserialize` 同步。
- `damage.ts` 新增 `updateTreasureVP(state)`：
  1. 撤销全部现有计分（对 `state.treasureScorer` 中每项 -1 VP 并清）。
  2. 扫描棋盘：对每个 `kind==='home'` 格所在扇区颜色 C，该格 `treasures` 中满足 `treasureHome[T] !== C` 的宝藏 T → 若 T 未被计分（scorer 空）→ 给 C 对应玩家 +1 VP 并记 scorer。不满足 → 撤销。
- 在以下时机后调用：`doMove`、`doPickUpTreasure`、`doDropTreasure`、`killWizard`（死亡掉落）、teleport/swap-positions/steal-treasure 等改变位置或宝藏的动作（即 `resolveEffect` 后统一在 `applyAction` 尾调用一次，简单可靠）。
- `checkWin` 不变（VP 变化后自动触发）。
测试：红巫师持蓝方宝藏站入蓝色 home → 蓝 +1 VP；带离 home → -1 VP。

### 4.8 R6 攻击墙/门/物体（前置：目标系统）
本项与 M2 目标系统强相关，M0 只做地基：
- `actions.ts` 新增 `{ type:'attack-object'; target: TargetRef; power?: number; kind?: DamageKind }`：校验 `target.kind` 为 `wall|door|object`，用 `damageObject` 结算裂缝（石墙满 5 毁、门满 3 毁），记 `attacked`，首回合禁止。
- 效果层 `damage` op 支持目标为 wall/door/object（见 M2 §5.2），武器调用走该 action。
测试：`attack-object` 打门 3 次毁门；打墙 5 次毁墙。

---

## 5. M1 反制窗口 + 统一对局驱动

### 5.1 类型与状态（`types.ts` `state.ts`）
- 见 §2.2：`AwaitingCast`、`GameState.awaitingCast`、新动作 `resolve-cast`/`counter`（改签名）、CardDef `counter?`。
- `CastInfo` 保留或删除（`awaitingCounter` 字段删除，替换为 `awaitingCast`）。`serialize/deserialize` 同步。

### 5.2 施法三分（`actions.ts`）
按 §2.3 重写 `doCast`；新增 `doResolveCast`、`doCounter`（重写）。`validateTarget` 增强在 M2，此处保持 wizard/cell。
注意：`doCast` 现在**不立即** `resolveEffect`；所有调用点（UI、sim、getLegalActions 的测试）语义变化，M6 UI 与 M1 sim 一起切换。

### 5.3 AI 接口扩展（`ai/bots.ts`）
```ts
export interface AIPlayer {
  name: string;
  chooseAction(state, legalActions): Promise<Action>;
  chooseCounter?(state, pending: AwaitingCast, myHand: string[]): Promise<{cardId:string}|null>;
}
```
- RandomBot / HeuristicBot / EvolvingBot 全部实现 `chooseCounter`：Random 随机或放弃；Heuristic 手中第一张匹配卡即反制；Evolving 按参数。
- `getLegalActions` 在 `state.awaitingCast` 存在时，对每位非施法玩家生成 `counter` 动作（含其手中所有匹配卡）。

### 5.4 统一驱动（新 `headless/run-game.ts`）+ `sim.ts` 重构
按 §2.4。`sim.ts` 改为 `runBattle` 薄封装；CLI 入口与 `--evolving` 保留。
`runBattle` 必须保证终止：`guard` 上限 + 连续失败 3 次 `end-turn` 兜底。

### 5.5 测试
```ts
// tests/core/counter.test.ts（新）
//  - cast 后 awaitingCast 置位、效果未结算、attacked 未置
//  - resolve-cast 后效果结算、攻击法术置 attacked
//  - counter 后效果不结算、卡进弃牌堆、attacked 不置位
//  - 合格反制者顺序 = 施法者下一座位
// tests/headless/run-game.test.ts（新）
//  - 用 stub bot（记录 chooseCounter 调用）驱动 2 人局到结束，无死循环
//  - 固定 seed 结果可复现
// sim.ts 回归：npm run sim 正常结束
```

---

## 6. M2 卡牌目标系统 + 能量规则 + 卡数据修正

### 6.1 目标校验全类型（`actions.ts` `validateTarget`）
按 `card.range` × `card.target` 校验：
| range \ target | 校验 |
|---|---|
| `adjacent` | 目标在相邻格（wizard/cell/door/wall/object） |
| `los` | 目标满足 LOS（传观察者颜色）；door/wall 目标须该边界直接可见 |
| `anywhere` | 任意（含跨扇区/跨传送门） |
| `same-sector` | 目标与施法者同扇区 |
| `caster` | 目标=施法者自己（transform/self） |

`TargetRef` 已含 wall/door/object/treasure/spell/cell/wizard 等 kind，实施者补齐各 kind 的解析与 LOS 判定（door/wall 用 `WallRef`/`DoorRef` 的边界坐标判定 LOS）。
未通过 → `{ok:false, reason}`。

### 6.2 `getLegalActions` 目标枚举（`ai/bots.ts`）
按 §2.5。核心函数：
```ts
function targetsForCard(state, p, card): TargetRef[]
```
对每张可施法手牌，产出 ≤K（建议 8）个目标：
- `target==='wizard'`：LOS/adjacent 内所有存活非施法者（+自目标若 `target` 含 self）。
- `target==='door'|'wall'|'object'`：范围内（LOS）所有该类实体。
- `target==='square'|'cell'`：范围内空方格（造物类）。
- `target==='self'`：仅自己。
同时对 `use-item`（武器）生成带目标动作。`castThreshold` 等参数在这里生效。
**判定标准**：RandomBot/EvolvingBot 施放攻击法术时必须带合法目标且实际造成伤害（M2 测试断言）。

### 6.3 能量规则（`effects.ts` + 卡数据）
- `damage` op 支持 `amount==='@energy'`（字符串）→ 用 `ctx.energy`。
- 批量改 15 张"伤害=能量"卡的 effect（见 §0.1 R11 清单）：`{op:'damage', amount:'@energy', kind:'magical'}`。
- `Powerstone`：施法燃料时若施法者携带 Powerstone → 每张能量卡 +1。
- `Add`（alchemy-add / mentalism-add）：允许把两张能量卡的 energyValue 合并到一次施法（`doCast` 的 `energyCard` 改为支持数组 `energyCards: string[]`，或保留单卡 + Add 特殊分支——实施者选一种，行为以 text 为准）。

### 6.4 卡数据修正
- 补齐 4 张反制卡的 `counter` 字段（§2.2 标注）。
- 15 张能量伤害卡 `amount:'@energy'`。
- `countsAsAttack` 标注（武器类攻击卡/法术，如 Fire Darts? 实施者按 text 判定；至少确保 `doCast` 首回合/攻击次数逻辑用该字段）。
- 校验器 `schema.ts` 增加对 `counter` 结构与 `amount:'@energy'` 的合法检查。

### 6.5 测试
- 每种 range×target 组合目标校验正反例。
- `getLegalActions` 生成带目标 cast；RandomBot 实际造成伤害。
- 能量伤害卡：基础 `energy=1` 打 1，附 energyCard 后打 `1+fuel`。
- 反制卡 counter 字段 schema 通过。

---

## 7. M3 持续效果系统（time-passes + 维持法术修饰）

### 7.1 模型扩展（`types.ts`）
`MaintainedSpell` 增加行为声明：
```ts
interface MaintainedSpell {
  cardId: string;
  energy: number;
  target: TargetRef | null;
  owner: number;
  behavior?: 'time-passes-damage' | 'modifier' | 'shield' | 'reflect' | 'summon';
  meta?: Record<string, number>;   // 如 {dmg:1}
}
```
effect 节点支持：
```json
{ "op":"apply-spell", "when":"time-passes", "timePassesDamage":2, "endsOn": "..." }
```
`apply-spell` op 把 `when:'time-passes'` 的卡登记到维持法术 `behavior:'time-passes-damage', meta.dmg`。

### 7.2 `resolveTimePasses`（`damage.ts`）真实化
对当前玩家每个维持法术：
1. `behavior==='time-passes-damage'` → 对 `target` 结算 `meta.dmg`（Acid Bath 打目标、Wall of Fire 打相邻、Fire Clock、Slow Death）。
2. 临时法术 -1 能量归零移除（现有逻辑保留）。
3. 触发被动修饰（Lifestone 回 1 血、Spellstone 多抽 1 —— 见 M4/M5）。

### 7.3 伤害管线挂钩（`damage.ts` `applyDamage`）
`applyDamage` 对目标结算前，依次应用修饰：
- `Pain Link`（reflect）：目标受的伤害原样返给来源巫师。
- `Bloodshard`：减 1 伤害。
- `Strength`：物理伤害 ×2。
- `Invisible`：受击时按概率闪避（`rng` 掷 6 面骰，≥3 闪避）。
- 这些修饰从**全局维持法术表**查询（对任意玩家的维持法术，作用于该玩家），而非仅当前玩家。实施者把 `applyDamage` 改造为"伤害前修饰 + 伤害 + 伤害后结算（reflect）"，并保持函数签名向后兼容（`applyDamage` 已带 `source`）。

### 7.4 测试
- Acid Bath 在目标回合 time-passes 阶段造成伤害。
- Wall of Fire 对相邻巫师造成伤害。
- Pain Link 反射、Bloodshard 减伤、Invisible 闪避（固定 seed 断言命中/闪避结果）。
- 临时法术能量归零移除（现有测试保持绿）。

---

## 8. M4 no-op 特殊法术落地（35 张）

逐个实现，按机制分组（文件以 `effects.ts` 为主，部分需新 action）：

| 机制 | 卡 | 实现要点 |
|---|---|---|
| 动态墙 | conjuring/elemental `wall-of-earth`(4) | `create-object` 复用，加"临时墙"标签；energy 归零移除 |
| 直线移动 | elemental `windrider`(2) | 新 op `move-line`：沿指定方向直走任意格（墙/门/物阻挡），消耗全部/固定 MP；需要 UI 方向选择——AI 枚举四个方向 |
| 伤害=能量（本组） | mentalism `powerthirst`(3) | `amount:'@energy'` 已由 M2 覆盖，改数据即可 |
| 能量合并 | alchemy/mentalism `add`(2) | §6.3 已覆盖 |
| 特殊抽牌 | mentalism `meditate`(2) | op `meditate`：抽 3 弃回上限，不结束回合 |
| 力透墙 | thaumaturgy `pass-through-wall` | op `move-through-wall`：穿过目标墙一次 |
| 吃墙回血 | mutation `wallivore`(2) | op `eat-wall`：目标墙毁，+2 生命 |
| 反制/防护类 | mutation/mentalism `featherweight`(2)、thaumaturgy `anti-anti`、`invisible` | 走 M1 counter 机制（`counter.requiresTargetingMe`）+ M3 修饰（invisible） |
| 进攻修饰 | elemental `fire-cloak`、mutation `strength`、`adrenaline`(2) | M3 修饰：punch +2 火伤 / 物理×2 / 每回合两次攻击（`attacked` 上限逻辑读取修饰） |
| 手牌修饰 | mutation `extra-arms`(2) | M3 修饰：携带物不计入手牌上限（`handSize` 读取该修饰） |
| 造物生物 | alchemy `homunculus`、`fool-s-gold` | Homunculus 最小生物实体（5.2/非目标）；Fool's Gold 钩到"敌方在你的 home 捡宝藏"事件 |
| 目标修正 | 3 张 `around-the-corner` | 施法时允许跨角（LOS 放宽 180°）；数据位+简单实现 |
| 其余 | alchemy `bloodshard`、`shatter`、mentalism `pain-link` | 走 M3 修饰 / 裂缝倍率 |

`text` 字段是每张卡的唯一行为依据；实施者**逐张对照 text 写实现**，并在 `tests/core/effects.test.ts` 为每张卡加冒烟断言（按 text 的可观察结果）。

**判定标准**：35 张 no-op 清零（卡数据 `op` 不再出现 `no-op`；确实无法实现的最小卡明确注释并抛 schema 警告）。

---

## 9. M5 物品/武器/造物系统（28 张 + 新动作）

### 9.1 武器攻击（`actions.ts` + `effects.ts`）
- `use-item` 支持 `target` 与 `fuel`：
  - 投掷类（Large Rock / Boomstone / Universal Solvent / Stone Spikes）：消耗物品，对目标结算伤害（物理/魔法按 text），置 `attacked`，首回合禁止。
  - Wizardblade：`fuel`=弃一张魔法卡，伤害=fuel 卡能量，对 object 每点伤害 1 裂缝（`Shatter` 类逻辑）。
  - Master Key：`target.door`，等同 pick-lock。
- 攻击墙/门/物体统一走 `attack-object`（M0 4.8）或 `use-item` 带 object target。

### 9.2 魔法石被动（`damage.ts` / `state.ts`）
| 卡 | 被动 |
|---|---|
| Lifestone | 回合初 +1 血（≤20） |
| Spellstone | 每回合多抽 1（discard-draw 的 draw 上限 +1） |
| Speedstone | 基础速度 +1（`baseSpeed` 读取） |
| Powerstone | 燃料能量 +1 |
| Brainstone | 手牌上限 +2（`handSize`/`MAX_HAND_SIZE` 相关改为动态读取） |
| Mightstone | 拳击额外物伤=骰点 |
| Visionstone | 施法可穿透 1 面墙/门（LOS 放宽） |
| Null Powder | 弃掉当反制（M1 counter 机制，`requiresTargetingMe:true`） |

被动统一查询辅助：`getPassives(state, playerId): Passives`（从 `carriedItems`+`maintainedSpells` 聚合）。

### 9.3 造物（`board.ts` + `effects.ts`）
- 占格物：Stone Block / Thornbush / Rosebush / Dust Cloud / Handful of Tacks / Booby Trap → 新 `cell.entities` 或复用 `objects`（带 `mobile:false` 与阻挡/LOS 阻断/进入触发伤害标签）。决策：**优先复用 `Cell.objects` + 附加标签**，减少模型改动。
- 阻挡：占格物阻止进入该格、阻断 LOS（M3 已做 LOS 钩子，此处接物）。
- 进入触发：Booby Trap / Tacks 在巫师进入该格时触发伤害（`doMove` 落点后钩子）。
- 破坏：thornbush/rosebush 1 裂缝或 1 火伤毁（`damageObject` 已有）。
- 限制（DESIGN §10）：不能造在 home 格、已有物/宝藏/巫师格、已有墙/门的边界——`create-object` 加校验。
- Stone Block 占满格阻挡通过：`moveDestination` 检查落点 `objects` 是否有占格物。

### 9.4 测试
- 每件武器：投掷伤害、消耗、置 attacked、首回合拒绝。
- 每块魔法石被动生效。
- 每个造物：放置校验、阻挡、进入触发、破坏。
- Wizardblade + Shatter 的 1 裂缝/点伤害。

---

## 10. M6 AI 对战 UI + 自进化 AI 真实对局

### 10.1 自进化 AI 真实化（`core/ai/evolving.ts`）
- `playMatch` 改为调用 `runBattle` 跑**真实对局**（2~4 人，固定 seed 或随机 seed），返回排名。
- 适应度 = 胜率加权（胜 +1、次名 +0.5、参与游戏基础分），而非 `evaluateParams`。
- `chooseAction` 直接用升级后的 `getLegalActions`（带目标），`scoreAction` 对带目标 cast 评估；`castThreshold` 参数接入。
- `evolve.ts` 脚本保留 CLI；输出 `evolved-params.json` 供 UI 选"evolving"时加载。

### 10.2 对战 UI（`client/main.ts` 重构 + 新 `client/battle-ui.ts`）
- 删除：热座 pass-device 覆盖层流程（`hotseat.ts` 的 turn-prompt 交互）、setup 的 H/B 座位选择、`GameUI` 的 human 分支。
- 新增配置屏（`main.ts` `showSetup` 改）：
  - 玩家数（2/3/4）、每座位 AI 类型（random/heuristic/evolving）。
  - 3 学派勾选（保留）。
  - 对战速度（慢/中/快/即时）、种子（可输入或随机）。
  - "开始对战"。
- 新增 `BattleUI`（`battle-ui.ts`）：
  - 复用 `renderBoard`/`renderCard`/玩家面板/日志。
  - 循环驱动：`runBattle(state, bots, {delayMs, callbacks:{afterAction: 重渲染}})`；`afterAction` 里 `await sleep(delayMs)`。
  - 显示当前行动 bot 的手牌（旁观可见，便于跟局）；可加开关"隐藏手牌"。
  - 反制窗口可视化：状态栏提示"X 正在反制…"（来自 `awaitingCast` 事件或 callbacks）。
  - 顶部控制：暂停/继续、加速/减速、结束重开（重新走 setup）、显示种子。
  - 结算：胜者面板（复用 `showGameOver` 改版或内联）。
- `index.html` 标题/说明更新（可选）。

### 10.3 测试（e2e 重写）
- `tests/e2e/game.spec.ts` 重写为 AI 对战：开 4 bot 局 → 断言棋盘渲染、bot 自动行动、日志滚动、若干步后无人崩溃；`maxTurns` 内结束或超时容忍。
- 用"即时速度 + 小 maxTurns"跑通一局（Playwright `timeout` 放宽）。
- 单元级：`runBattle` 2 人局正常决出胜者（多数 seed 在 500 回合内）。

---

## 11. M7 回归与打磨

- 全量回归：`npm run typecheck` / `npm run test` / `npm run build`。
- `npm run sim` 多 seed（如 seed 1..20）稳定性：无死循环、无异常、能在合理回合内出胜者（杀敌/宝藏双 VP 源下应显著提升）。
- 平衡性粗调：EvolvingBot 默认参数观察；evolved-params.json 预置一份可用的进化结果。
- 更新 `USAGE.md`（热座→AI 对战操作说明）、`PROJECT_REPORT.md`（新能力）。
- 清理：删除或标注不再使用的 `hotseat.ts` 回合切换函数；`DESIGN.md` 中"绕边"等被决策取代的条目加注。

---

## 12. 实施顺序与提交建议

1. **每个里程碑一个提交**，commit message 注明里程碑与红→绿测试。
2. **不要跳里程碑**：M4 依赖 M3 的修饰/持续效果，M6 依赖 M1 的驱动。
3. 卡数据修改（§6.4、§8 的 amount 改 @energy）单独提交，便于 review。
4. 每步先写失败测试再实现，最后跑全量。
5. 不确定的规则细节（眩晕精确行为、Fool's Gold 触发时点、Hold-open 判定）以卡 `text` + `WizWar_v2.1.pdf` 为准，并在实现处注释依据。

---

## 13. 验收清单（全部满足即完成）

- [ ] M0 规则测试：跨扇区墙阻挡、关墙/门挡 LOS、门重锁、首回合禁攻击法术、眩晕半速、手牌超限弃牌、宝藏 VP 增扣。
- [ ] M1：cast→awaiting→(counter|resolve) 流程测试通过；`runBattle` 驱动 sim 与 UI 共用；`npm run sim` 正常。
- [ ] M2：全类型目标校验、`getLegalActions` 带目标、能量伤害=energy、Powerstone/Add 生效。
- [ ] M3：time-passes 伤害、Pain Link/Bloodshard/Strength/Invisible 修饰生效。
- [ ] M4：35 张 no-op 清零且各有冒烟测试。
- [ ] M5：28 张物品全生效（武器/魔法石/造物各测试）。
- [ ] M6：浏览器开 AI 对战局能自动跑到分出胜者；evolving 用真实对局进化。
- [ ] 全量 typecheck/test/build 绿；`npm run sim` 多 seed 稳定。

---

## 14. M0-M3 审查返工清单（2026-08-23 追加）

> 审查方式：typecheck/build/90 测试全绿，但逐条对照 + 实际跑 `npm run sim` 与复现脚本后，发现下述问题。
> **判定：M0 基本达标；M1 反制系统真实流程不可用；M2 半成品；M3 为死代码。**
> 返工顺序即下方编号顺序。每条都先写"当前会失败、修后通过"的测试（不得再用空断言，见 §14.6）。

### 14.1 【致命】反制系统在真实流程永远失败
现状：
- `applyAction` 将 `counter` 动作派发给 `currentPlayer`，而反制窗口内 currentPlayer 恒为施法者；
  `doCounter` 因此必返回 `"Cannot counter own spell"`。
- `run-game.ts` `runCounterWindow` 调用 `applyAction({type:'counter',...})` 后**不检查 `res.ok`**，
  失败后照常 fall through 到 `resolve-cast` —— 反制被静默吞掉。
- `tests/core/counter.test.ts` 靠手动 `state.currentPlayer = opponent.id` 绕过，掩盖了 bug。

返工：
1. 反制是"非当前玩家"的动作。给 Action 增加 `playerId`：`{ type:'counter'; cardId: string; playerId: number }`，
   在 `applyAction` 里对 `counter` 用 `action.playerId` 定位玩家（不走 `currentPlayer`）。
2. `doCounter` 移除 `notTurn` 检查（反制者本就不是当前玩家），改为校验：
   - `state.awaitingCast` 存在且 `playerId !== caster` 且在 `counterOrder` 内；
   - 该卡在手，且 `card.counter` 与待反制法术匹配（`blocks` 含待反制卡的 type；`requiresTargetingMe` 时目标是自己）。
   - 不满足 → `{ok:false, reason}`。
3. `runCounterWindow` 检查 `applyAction` 结果：反制成功才 break 并跳过 resolve；失败则记录并继续问下一个。
4. 重写 `counter.test.ts`：删除手动切 `currentPlayer`；改为直接驱动 `runCounterWindow` 真实路径断言 `countered===true`。
5. 补 4 张反制卡 + Full Shield + Null Powder 的 `counter` 字段数据（§2.2 标注）。

### 14.2 【致命】sim 跑不出胜者，对局卡死 "Turn 1: blue"
现状：
- `sim.ts` **未重构为使用 `runBattle`**，仍是旧式同步循环，且不处理反制窗口 —— bot 施法后 `awaitingCast`
  永不 resolve，引擎卡在等待态。
- 即便走 `runBattle`（实测复现），也卡死：动作连败使 `failCount` 累计 >3 触发 `end-turn`(endMoveCast) 后
  **中断内层循环**，discard-draw 被跳过；外层循环随即对同一玩家重新 `startTurn`，turn 永不推进。
- 实测 `npm run sim` 输出 `Winner: None (max turns)`，日志尾部反复 "Turn 1: blue wizard's turn"。

返工：
1. `sim.ts` 改为 `runBattle` 薄封装（§5.4 既定），删除重复的旧循环。
2. 修 `runBattle` 失败兜底：`failCount>3` 时**不要** `end-turn`+break 打断回合。
   正确做法：单次动作失败就跳过该动作继续（`continue`），只在 `getLegalActions` 为空时才 `end-turn`。
3. `runBattle` 收敛性验证：写测试断言固定 seed 下 turnNumber 能递增、能进入 discard-draw、
   多 seed（至少 5 个）在 500 回合内结束或至少 turnNumber 显著增长。
4. `run-game.ts` 的 `runCounterWindow` 在 `counterOrder` 为空（无合格反制者）时立即 `resolve-cast`，避免悬挂。

### 14.3 【高】M3 持续效果与 `@energy` 是死代码，卡牌数据未接入
现状：
- 没有任何卡牌 effect 使用 `op:'apply-spell'`；`apply-spell` 也不写 `behavior`/`meta` →
  `damage.ts` 的 `spell.behavior==='time-passes-damage'` 分支永不可达。Acid Bath 等仍是 `op:'no-op'`。
- 没有任何卡牌使用 `amount:'@energy'`；15 张"伤害=该法术能量"卡数据未改，实际走 `base+(energy-1)`，
  与卡面文字不符。
- `hasModifier` 用 `card.id.includes(keyword)` 字符串匹配，且对应卡（pain-link/strength/invisible/fire-cloak）
  全部仍是 no-op → 真实对局里无人能获得修饰，M3 系统整体不可达。

返工：
1. `apply-spell` 解析 effect 节点的 `when`/`timePassesDamage`，写入 `MaintainedSpell.behavior/meta`。
2. 改卡数据：Acid Bath×2、Wall of Fire、Fire Clock、Slow Death、Fool's Gold、Lifestone、Homunculus、Pain Link、
   Strength、Invisible、Featherweight、Extra Arms、Adrenaline、Shatter、Fire Cloak 等 → 用真实 op +
   `when:'time-passes'` 或修饰语义（以每张卡的 `text` 为准）。
3. 15 张能量伤害卡 effect 改 `{op:'damage', amount:'@energy', kind:'magical'}`（§0.1 R11 清单）。
4. `hasModifier` 改为显式按 `behavior`/`meta` 判定，去掉 `id.includes`。
5. `resolveTimePasses` 顺序保持：先结算伤害/修饰，再扣能量。

### 14.4 【高】攻击次数未对施法强制
现状：`doCast`/`doResolveCast` 只置 `p.attacked`，从不检查；`getLegalActions` 在 `p.attacked` 时仍生成
`cast` 攻击法术动作 → 一回合可无限放攻击法术。规则：攻击法术/武器/拳击三选一，每回合一次。

返工：
1. `doCast`：`isAttackCard(card) && p.attacked` → 拒绝。
2. `getLegalActions`：`p.attacked` 时不再生成攻击型 `cast`/`use-item`/`attack-object`（非攻击法术保留）。
3. 测试：施放攻击法术后再施放 → 失败；施放中性法术 → 允许。

### 14.5 【中】目标枚举只覆盖 wizard/self
现状：`targetsForCard` 仅处理 `card.target==='wizard'|'self'`。door/wall/object/square 目标不生成 →
Pick Lock / Create Wall / 投掷物在 bot 手中仍空放。

返工：按 §6.2 补齐各 target 类型的合法目标枚举（含 LOS/相邻判定），并加 `attack-object` 动作生成。

### 14.6 测试质量
现状：新增 23 个测试中多数是空断言（`expect(true).toBe(true)`、`expect(x>=0).toBe(true)`、
`expect(typeof x).toBe('boolean')`、`life < 20` 恒真），且有的分支压根不执行（`if (doorSide)` 无门即跳过）。

返工：
- 禁止空断言。每条规则测试必须有"可观察、可失败"的断言（具体值/具体布尔）。
- 修 `tests/core/m3-effects.test.ts`：真实施放 Acid Bath → 推进回合 → 断言目标扣血；真实施放 Bloodshard/Pain Link → 断言伤害减免/反射。
- 修 `tests/core/m0-rules.test.ts` / `m2-targeting.test.ts`：把 `if (doorSide)` 条件分支改造成显式构造门/墙后断言。
- 补一个端到端反制测试：走 `runBattle`，stub 一个必反制的 bot，断言被反制的法术未结算。

### 14.7 次要（M4 前顺手修）
- `consumeEnergyCardFuel` 是空壳，且每回合刷一条误导日志 —— 要么实现、要么删除。
- `relockDoorsForPlayer.isAdjacentToDoor` 检查"任意玩家相邻"而非持有者相邻。
- 眩晕：当前可"移动 1 步 + 攻击"同时发生；DESIGN 要求二选一。
- `doCounter` 校验反制资格（并入 §14.1）。
- 棋盘连通性观察：board-data 仅 4 扇门、0 扇边界门，扇区间靠少数墙缺口连通；4 人局对局偏长，
  M7 平衡时考虑（不影响 M4-M6 返工）。

### 14.9 返工完成判据
- [ ] `runCounterWindow` 真实路径下反制成功（`countered===true`），被反制法术未结算、attacked 不置位。
- [ ] `npm run sim`（heuristic，seed 42）不再 `Winner: None`，turnNumber 正常递增。
- [ ] Acid Bath 施放后推进回合能扣目标血；`@energy` 伤害卡按能量结算。
- [ ] 一回合施放两个攻击法术被拒绝。
- [ ] 无空断言；typecheck/test/build 全绿。

---

## 15. 返工复查后补充（2026-08-23 追加）

> 复查结论：§14.1-14.6 全部修复 ✅（反制真实路径可用、turn 推进正常、M3 接线完成、
> 攻击次数强制、目标枚举补齐、测试不再空断言）。93 测试 / typecheck / build 全绿。
> 剩余问题见下。**优先做 15.1**（否则 AI 对战永远出不了胜者），其余顺带修。

### 15.1 【重要】bot 够不着胜利条件，sim 500 回合无胜者（0 击杀 0 VP）
现状：`getLegalActions`（`src/core/ai/bots.ts`）在 move-cast 阶段只生成 move/punch/cast/use-item/end-turn，
**没有 `pick-up-treasure` / `drop-treasure` / `pick-up-object` / `attack-object`**。
后果：宝藏归家这条 VP 路径对 bot 完全关闭；击杀路径因 LOS 被墙挡 + HeuristicBot 被动而极少触发。
实测 5 个 seed：500 回合全无胜者，5-11 次伤害事件、0 击杀、0 VP。

返工：
1. `getLegalActions` 增加（move-cast）：
   - `pick-up-treasure`：当前格有宝藏且 `p.carriedTreasure === null` 时生成。
   - `drop-treasure`：`p.carriedTreasure !== null` 时生成。
   - `pick-up-object`：当前格有可拾取物体（`cell.objects.length > 0`）且手牌未满时生成。
   - `drop-item`：携带物非空时生成（可留到 M5）。
   - `attack-object`：目标墙/门/物体可及（复用 `targetsForCard` 的 wall/door 枚举）时生成（需 `attack-object` 支持 door/wall target，M0 已有）。
2. `HeuristicBot.chooseAction` 增加优先级（置于 punch 之前或之后，自行判断）：
   - 若在敌方宝藏格 → `pick-up-treasure`；若携带敌方宝藏且站在自家 home 格 → 放下或直接结束回合（触发 `updateTreasureVP`）。
   - 拾取后朝自家 home 移动（复用现有"向目标移动"逻辑，目标改为自家 home 格）。
3. 验收：`npm run sim`（heuristic）至少部分 seed 在 500 回合内出胜者（通过宝藏 VP 或击杀）；全 seed 不再全是 `Winner: None`。

### 15.2 施法卡不回收（牌库经济泄漏）
现状：`doCast` 从手牌移除卡后从不推入弃牌堆；`doResolveCast`（结算与被反制两条路径）也不推。
后果：施放过的卡永久消失，不进 discard、不参与重洗，长局牌库持续变薄。
返工：
1. `doResolveCast`：结算成功后 `state.discard.push(cardId)`；被反制路径同样 `state.discard.push(cardId)`。
2. `doCounter` 中若被反制的是已施放的卡，由 resolve-cast 统一入弃牌堆（避免重复推）。
3. 测试：施放后卡在 discard；被反制后卡在 discard。

### 15.3 反制成功后 `awaitingCast` 残留
现状：`doCounter` 置 `countered=true` 但不清空 `awaitingCast`，直到下次施法才被覆盖。
返工：`doCounter` 成功后直接 `state.awaitingCast = null`（法术已作废，无待结算内容）。
注意同步调整 `runCounterWindow`：反制成功后其后续 `if (state.awaitingCast && !countered) resolve-cast` 已因 awaitingCast 为 null 而自然跳过。

### 15.4 【高】HeuristicBot 贪心寻路遇墙不绕路，捡宝后到不了敌人 home 投放（2026-08-23 追加）
现状：
- 前一轮会话已修：`homeRef` 对齐到 board-data 的 (2,2)、`getLegalActions` 用 `wallBetween` 过滤墙向 move、
  HeuristicBot 加 treasure-seeking 与"drop 到敌人 home"目标（`targetHome` 取最近存活敌人的 `homeRef`）。
- 仍卡死：`chooseAction` 的移动策略是**曼哈顿距离贪心**——每次只选使到目标格曼哈顿距离减 1 的相邻 move，
  遇墙（`Cannot move that way`）不换路。实测 green 玩家在 (2,2)/(1,2) 或 (1,1)/(2,1) 间 N/S 震荡，
  `npm run sim` 仍 `Winner: None (max turns)`、`pick` 后可出现但 `drop`/`scores 1 VP` 永不发生。
- 得分链路确认：`damage.ts` `updateTreasureVP` 只对"位于非本 sector 的 home 格"的宝藏计 VP
  （`homeColor !== color`），所以 drop 目标必须是敌人 sector 的 home，且玩家得实际走到该格。
- **新发现**：board-data.json 门连接异常——4 扇门全指向本 sector（blue→blue, red→red, yellow→green, green→green），
  sector 间无通路，BFS 跨 sector 返回 null。需先修门数据再验证寻路。

返工：
1. 修 board-data.json 门连接：确保相邻 sector 间有门可通行（至少 4 扇边界门）。
2. 给 HeuristicBot 换 BFS 寻路（已实现 `bfsFirstStep`，待门修好后验证）：以 `state.board` + `wallBetween`/`adjacentRefs`
   建图，从 `p.pos` 到目标格（treasure 格或敌人 home 格）做 BFS，取第一步。目标格仍为空时退回原有策略。
3. 用 `runBattle` 或 `npm run sim`（heuristic，seed 42）验证：日志出现 `picks up treasure` → `drops treasure`
   → `scores 1 VP`，且能产生赢家（§14.2 判据同款）。
4. 加一条回归测试：固定 seed 下断言宝藏最终被投放到敌人 home 格、`vp` 事件发生（不再依赖"碰巧能走到"）。

### 15.5 记录在案（非本批目标）
- 30 张 no-op 卡（M4 范围，预期）。
- 眩晕"移动+攻击可同时"（DESIGN 要求二选一）——顺手可在 M4 时改。
- `doAttackObject` 裂缝阈值用原始伤害（5/3）而非"3 伤害=1 裂缝"——平衡性，M7 定。

### 15.5 已知问题（推迟到 M6/M7，不阻塞 M4/M5）
**HeuristicBot 宝藏逻辑方向反了**（`src/core/ai/bots.ts`）：
1. Priority 1（~315-328 行）：携带宝藏且站在**敌方** home → `drop-treasure` —— 把宝藏扔进敌方 home 给敌方计分。
2. Priority 4（~352-365 行）：携带宝藏时 BFS 目标 = **敌方** home —— 主动朝敌方老家送宝。

影响：sim 中 bot 给敌人送分，VP 在 0-1 间振荡，多数 seed 500 回合无胜者（3/7 靠击杀+震荡赢）。
**修法**（M6 重做 bot 策略时一并改，改动很小）：
- Priority 1 → 站在**自己** home（`p.pos.sector === p.color` 且格 `kind==='home'`）才 `drop-treasure`。
- Priority 4 → 携带宝藏时目标 = `homeRef(p.color)`（自己 home），非敌方。

> 记录目的：M6 的 AI 对战 UI 必然要调 bot，届时顺手修；M4/M5 不受影响，先推进。

### 15.6 新发现：宝藏自循环（§15.5 修复后引入，2026-08-23）
§15.5 方向修对后，HeuristicBot 在**自家 home** 陷入捡/放死循环：
- Priority 1（只捡敌方宝藏）会把**已进自家 home 的敌方宝藏**再捡起来；
- Priority 0（自家 home + 携带 → 放下）又放下；
- 无限捡/放，每次触发一次 `updateTreasureVP` 的 unscore/score，VP 在 0↔1 间振荡。

**已修（2026-08-23 收工）**：`src/core/ai/bots.ts` Priority 1 pick-up 过滤里跳过
"宝藏当前所在格是自家 home sector（`cell.sector === p.color` 且 `kind==='home'`）"的宝藏——已入账的别捡。
⚠️ 复查更正：早前"sim 0/10 胜"是我分析脚本**多 seed 共享棋盘对象**导致的污染假象。
**每 seed 独立棋盘实测：真实胜率 11/16（69%）**，且确定性 ✅（同 seed 复现一致）。
高 vp 事件数（~1267/200 回合）是 `updateTreasureVP`"全撤销再重扫"产生的**虚假 -1/+1 事件**（净值 0，刷爆日志），
不是捡/放循环（实际 drops 仅 3 次）。

**余下（M6/M7）**：
- `updateTreasureVP` 只在真实变化时发事件（去掉每次动作的虚假 revoke/rescore）。
- stall（5/16 seed）：bot 凑不满 2 VP（每局恰 1 击杀后陷入僵局；红方胜率高=棋盘优势）→ M6 调 bot 策略、M7 平衡。

---

## 16. 规则完整度审核返工清单（2026-08-24 追加）

> 本清单由 Claude 对当前代码做逐条验证后产出。**判定：114 测试全绿，但存在 4 个严重规则 bug、
> 一批高优先级未落地机制、M5（28 张物品卡）实际未实现、真实棋盘拓扑零单测。**
> 每条均"先写当前会失败、修复后通过"的红→绿测试；不得用恒真断言（见 §16.5）。
> 完成后 `npm run typecheck` / `npm run test` / `npm run build` 全绿。

### 16.1 严重 bug（先修，每个独立可测）

**16.1.1 LOS 对角线不查墙（S1）**
- 现象：`board.ts` `wallBlocksLOS` 对 `dr≠0 && dc≠0` 直接 `return false`（399 行），斜向视线永远畅通。
  实测 (0,0)→(2,2) 穿过两面墙 LOS 仍为 true；Bresenham 对角线步全放行。
- 期望：对角线步穿过"两面墙合围的角"时应阻挡（Wiz-War LOS 规则：中心连线被墙挡）。
- 修法：在 `wallBlocksLOS` 补对角线分支。步 (r,c)→(r+1,c+1) 时，检查两面构成该角的墙是否都在
  （如 `wallBetween(A,'S') && wallBetween(A,'E')`，door 同理）；都在才挡，单面墙放行。
  同时门（关门）按同样规则参与。
- 测试（红→绿）：`tests/core/board.test.ts` 加——(0,0) 与 (1,1) 之间两面墙合角时 `hasLOS=false`；
  单面墙时 `hasLOS=true`；关门合角时 `false`。

**16.1.2 玩家0死后全局回合冻结（S2）**
- 现象：`turn.ts` `advancePlayer` 只在 `next === 0`（113 行）时递增 `turnNumber`。玩家 0 死亡后
  `next` 永不为 0 → 回合计数冻结。实测玩家 0 死后 advancePlayer 20 次 turnNumber 卡在 1，
  `isFirstTurn` 恒真 → 首回合禁攻击永久生效（若死在第 1 回合）。
- 期望：全局回合按完整轮次递增，与玩家 0 死活无关。
- 修法：改为按轮次边界递增：`if (next <= state.currentPlayer) state.turnNumber++;`
  （从大索引推进到小索引 = 跨过一轮；死玩家跳过不影响）。
- 测试：构造 4 人局杀死玩家 0，`advancePlayer` 若干次后 `turnNumber` 正常递增；
  玩家 0 存活时行为与现在一致（回归）。

**16.1.3 手牌上限不一致：5 vs 7（S3）**
- 现象：`passives.ts` `getHandSize` 返回 `baseSize = 5`（88 行），但 DESIGN §10 规定上限 **7**
  （含携带物+维持法术）。`doDraw` 按 `MAX_HAND_SIZE=7` 判断（actions.ts:710），
  `forceDiscardToLimit` 按 `getHandSize()=5` 强弃（turn.ts:90）→ 每回合"抽 2 → 被强弃 2"空转。
  sim 日志可见连续 "draws 2 cards / discards (hand limit)"。
- 期望：基础上限 7；Brainstone +2 → 9。
- 修法：`getHandSize` 改为 `return MAX_HAND_SIZE + (brainstone ? 2 : 0);`（从 `state` 导入 MAX_HAND_SIZE）。
- 注意：`tests/core/m5-items.test.ts:51` 断言 `getHandSize===7`（5+2，codify 了错误行为），
  需同步改为 9。
- 测试：无 Brainstone 时 `getHandSize===7`；有 Brainstone 时 `===9`；手牌 8 结束回合被强弃到 7。

**16.1.4 施法/用物品失败吞卡（S4）**
- 现象：`doCast` 253 行先移走施法卡，260 行才校验能量卡。能量卡非法/不在手 → 施法失败但法术卡已被消耗。
  实测非法燃料后手牌只剩 energy，zot 被吞。`doUseItem` 同样（507 行移物品、519 行验燃料）。
- 期望：校验全部通过后才扣卡；失败不消耗任何卡。
- 修法：把能量卡/燃料卡校验（在手、`energyValue>0`）提前到扣卡之前；失败直接返回，不触手牌。
- 测试：非法能量卡施法 → `ok:false` 且法术卡仍在手牌；非法燃料 use-item → `ok:false` 且物品仍携带。

### 16.2 高优先级（规则未落地）

**16.2.1 静态墙不可攻击**
- `doAttackObject` 只查 `cell.dynamicWalls[ref.side]`（actions.ts:553），真实棋盘静态墙永不损坏。
- 期望：静态墙可被 `attack-object` 累积伤害（石墙 5 裂缝，见 16.2.2 阈值）。
- 修法：`attack-object` 的 wall 分支同时支持 `dynamicWalls` 与静态 `walls`（静态墙用独立 cracks 计数，
  可给 Cell 增加 `wallCracks` 或复用 WallToken 语义；设计自定，行为一致即可）。
- 测试：对静态墙攻击 5 次（每次 3 伤）→ 墙消失/可通行。

**16.2.2 墙/门毁坏阈值用伤害当裂缝（S5）**
- 现象：`doAttackObject` 用 `dw.cracks >= 5`（actions.ts:558）、`door.cracks >= 3`（571 行）判断毁坏，
  但 `damageObject`（damage.ts）把 `cracks` 当**伤害**累加（`obj.cracks += effectiveAmount`），
  返回的是"新增完整裂缝数"。→ 5 点伤害毁墙（应为 15 = 5 裂缝 × 3）、3 点毁门（应为 9）。
- 期望：按 DESIGN §10「每 3 点伤害 = 1 裂缝；石墙 5 裂缝、门 3 裂缝」。
- 修法：把墙/门损坏按**裂缝数**判定。可在 `damageObject` 里同时维护裂缝计数，或改为
  `cracks = Math.floor(damage / 3)` 判定阈值。§15.5 曾记录"平衡性 M7 定"，本条改为直接修（规则明确）。
- 测试：攻击墙累计 15 伤才毁；攻击门累计 9 伤才毁；Shatter 翻倍仍按裂缝折算。

**16.2.3 Rotate Sector 纯装饰**
- `effects.ts:266` 只改 `sector.rotation`，移动/LOS 从不读取（grep 确认唯一写入、无读取）。
- 期望：Rotate Sector 使扇区顺时针转 90°，墙/门/移动/LOS 随之变化（Wiz-War 规则）。
- 修法：移动/LOS 查墙/门前先按 `rotation` 映射方向；或实现为旋转时实际改写 grid 墙/门（数据备份还原）。
  选择一种，行为以卡面 text 为准。
- 测试：转 90° 后原东墙变南墙，原东向移动被挡、南向放行。

**16.2.4 Visionstone 被动失效（死代码）**
- `los.ts` `canSee`（8 行）定义后无调用（grep 确认）；`validateTarget`/`getLegalActions` 直接调 `hasLOS`。
- 期望：携带 Visionstone 的施法者可穿透 1 面墙/门施法。
- 修法：`validateTarget`（actions.ts:466 等）的 los 校验改走 `canSee`（或等价逻辑），
  并在 `canSee` 里实现"路径被恰好 1 面墙/门挡时放行"（不要现在的"有 Visionstone 就全通"）。
- 测试：有 Visionstone 时隔 1 墙施法成功、隔 2 墙失败；无 Visionstone 隔 1 墙失败。

**16.2.5 Spellstone 被动失效（死代码）**
- `passives.ts` `getDrawCount`（117 行）无调用；`doDraw`（actions.ts:706-725）硬编码 `count > 2`。
- 期望：携带 Spellstone 每回合多抽 1。
- 修法：`doDraw` 用 `getDrawCount(state, p.id, 2)` 作为上限；`getLegalActions` discard-draw 阶段同步。
- 测试：有 Spellstone 时可一次抽 3；无时最多 2。

### 16.3 M5 物品卡落地（28 张 `op:'item'` 全部是 no-op）

- 现状：所有 item 卡 `effect.op === 'item'` → `effects.ts:622` case 'item' 直接 break，**使用即空放**。
  实测 Boomstone 使用返回 ok 但 0 事件。魔法石被动部分已接线（getPassives），但**武器/投掷物/放置物/开锁**
  全部无效；`doUseItem` 消耗物品后无效果。
- 目标：28 张 item 卡按卡面 text 生效。实现方式任选（effects.ts 按 card.id 分发 / 改卡数据加真实 op + 新增 op handler），
  行为以 `text` 为准。
- 逐卡预期行为（分组）：
  | 分组 | 卡 | 预期 |
  |---|---|---|
  | 投掷物（攻击，消耗，置 attacked，首回合禁） | `cantrip-large-rock`（3 伤）、`alchemy-boomstone×3`（范围爆伤）、`elemental-stone-spikes`（2+ 伤）、`conjuring-handful-of-tacks`（3 伤或放置） | 对 LOS 内目标格/巫师结算物理/魔法伤害；物品入弃牌堆 |
  | 放置物（阻挡/触发，消耗） | `conjuring-booby-trap`（进入 4 伤后消失）、`conjuring-handful-of-tacks`（进入 3 伤残留）、`conjuring-dust-cloud`（阻挡 LOS）、`conjuring-thornbush/rosebush×2`（阻挡、1 裂缝毁、火伤 1 即毁）、`elemental-stone-block`（占格阻挡移动） | 复用 `create-object` 校验（home/已有物/宝藏/巫师禁放） |
  | 武器 | `thaumaturgy-wizardblade`（fuel=弃一张魔法卡，伤害=fuel 能量；对 object 1 伤=1 裂缝） | 攻击次数/首回合同攻击法术 |
  | 开锁 | `thaumaturgy-master-key`（目标门 → 等同 pick-lock） | 目标 door |
  | 魔法石（携带被动） | Lifestone/Spellstone/Speedstone/Powerstone/Brainstone/Mightstone/Visionstone/Null Powder | 已接线者核对；16.2.4/16.2.5 接线 Spellstone/Visionstone；Mightstone 改 `state.rng` |
  | 能量卡用途 | `alchemy-stone-dead`（ev=3） | 作为燃料（已支持） |
- 注意：`checkEntryTriggers`/`moveDestination`/`doAttackObject` 已用硬编码 cardId 钩子（`conjuring-booby-trap`、
  `cantrip-stone-block`、thornbush/rosebush），落地后统一改为按卡数据驱动，消除硬编码。
- 测试：每件武器/放置物/开锁至少一条"使用 → 可观察结果"断言（伤害/阻挡/触发/开门）；投掷物置 attacked、首回合拒绝。
  参照 `tests/core/m5-items.test.ts` 现有骨架，但补真实效果断言（现 11 个测试只测 getPassives/硬编码钩子，不测"使用物品生效"）。

### 16.4 AI / 对战驱动

**16.4.1 EvolvingBot 用占位棋盘进化**
- `evolving.ts:278` `playMatch` 用 `createBoard()`（占位，无墙无门），进化出的策略不适用真实棋盘。
- 修法：改从 `board-data.json`（`convertBoardData` + `createBoardFromTopology`）建棋盘，与 `sim.ts` 一致。
- 测试：`playMatch` 使用真实拓扑（断言 board 有墙）。

**16.4.2 EvolvingBot 死参数 + 不主动寻宝**
- `castThreshold`、`energyCardPriority` 声明但 scoreAction 从未使用。
- `pick-up-treasure`/`drop-treasure` 动作得 0 分 → EvolvingBot 基本不走宝藏 VP 路线。
- 修法：把参数接入评分；携带宝藏时目标自家 home（参照 HeuristicBot 15.5 修法），无宝藏时朝最近敌方宝藏走。

**16.4.3 getLegalActions 缺失动作**
- `bots.ts` `getLegalActions` 不生成 `boost-speed`、`drop-item`、`end-spell`、`cast` 带 `energyCard` 燃料、
  反制窗口的 `counter`。
- 修法：move-cast 阶段补 `boost-speed`（手中有 energy 卡且未提速）、`drop-item`（携带物非空）、
  `end-spell`；`cast` 对能量伤害卡附一份带 `energyCard` 的变体（bot 可用能量卡加油）。
- 另：移动动作只用 `wallBetween`（bots.ts:64），不查门/跨扇区墙 → 对锁门/边界墙空试，改用 `moveDestination` 过滤。

**16.4.4 HeuristicBot.chooseCounter 盲目反制**
- 选手牌第一张 counter-spell 卡，不检查 `counter.blocks` 是否匹配待反制法术 → 常被 `doCounter` 拒绝。
- 修法：只返回 `blocks` 包含待反制卡 type 的卡（`requiresTargetingMe` 时校验目标是自己）。

### 16.5 测试与覆盖（红线，不达标不收）

1. **真实拓扑零单测**：`board.test.ts`/`m0-rules`/`m3-effects` 全用占位 `createBoard()`（无墙无门）。
   修法：新增 `tests/core/real-topology.test.ts`，从 `board-data.json` 建棋盘，覆盖：
   - 跨扇区边界墙阻挡移动（构造边界墙正反两侧各存一遍的两种情形）；
   - 边界门：关门阻挡、开门放行、穿过重锁；
   - 真实 home 格 (2,2) 与宝藏 VP 增扣（红宝藏入蓝 home → 蓝 +1，移走 -1）；
   - LOS 对角线（16.1.1）与关门挡 LOS；
   - 门被锁时 bot 移动不生成非法动作（16.4.3 修后）。
2. **恒真断言清零**：grep 扫 `tests/` 清除 `expect(x.length >= 0).toBe(true)`、
   `expect(typeof x).toBe('boolean')`、`expect(x.vp >= 0).toBe(true)` 等（现存于
   `m2-targeting.test.ts:45,57`、`m0-rules.test.ts:98,118`），替换为具体值断言。
3. 每条 16.1/16.2/16.3 修复必须附"当前红、修后绿"的断言。

### 16.6 实施顺序与验收判据

顺序：
1. §16.1（S1-S4）→ 2. §16.2（高优先级机制）→ 3. §16.5.1 真实拓扑测试（与 1、2 交叉补）
→ 4. §16.3（M5 物品）→ 5. §16.4（AI）→ 6. 全量回归。

验收判据（全满足）：
- [ ] LOS 对角线被墙角阻挡；玩家 0 死后 turnNumber 仍递增；手牌上限 7（Brainstone 9）；失败施法不吞卡。
- [ ] 静态墙可毁且按裂缝阈值（15 伤毁墙 / 9 伤毁门）；Rotate Sector 影响移动；Visionstone/Spellstone 生效。
- [ ] 28 张 item 卡每张至少一条真实效果断言；`npm run sim` 中可见投掷物/放置物/开锁/武器日志。
- [ ] `getLegalActions` 含 boost-speed/drop-item/带燃料 cast；EvolvingBot 用真实棋盘进化且参数接线。
- [ ] `tests/core/real-topology.test.ts` 通过；无恒真断言；typecheck/test/build 全绿。

---

## 17. §16 复查清单（2026-08-24 qwen 修复后，Claude 逐条复验）

> 复查结论：§16 中 15 项已修复（119 测试全绿），**6 项仍未修**，另确认 sim 胜率问题根因。
> 实施者按下列编号继续，每条仍是"当前会失败、修复后通过"的红→绿测试。

### 17.1 已验证修复（勿重复改）
S1 LOS 对角线、S2 回合冻结、S3 手牌上限 7、S4 施法/用物品吞卡、静态墙可攻击、裂缝阈值
（墙 15 伤/门 9 伤）、Visionstone/Spellstone 接线、物品卡主体 24/28、EvolvingBot 真实棋盘+参数、
getLegalActions 补 boost-speed/drop-item/end-spell、chooseCounter 校验 blocks、real-topology 测试。

### 17.2 仍未修（按优先级）

**17.2.1 【中】Rotate Sector 仍纯装饰**
- 现状：`sector.rotation` 只写不读（`effects.ts:266` 改值，移动/LOS/门完全不看）。实测 rotation=1 后
  原南墙不挡西向、也不开南向，转 90° 无任何效果。
- 期望：扇区顺时针转 90°，墙/门/移动/LOS 随之旋转（Wiz-War 规则）。
- 修法（选一，行为一致即可）：① 在查墙/门前按 `rotation` 映射方向（`wallBetween`/`doorBetween`/`moveDestination`
  读取 `sector.rotation` 后把 dir 逆旋转回原始方向再查）；② 施法时实际改写 grid 墙/门（保存原拓扑备份，Dispel/结束恢复）。
  推荐 ①：改动集中、不需备份。
- 测试：`real-topology.test.ts` 或 `board.test.ts`——给某扇区造单面南墙，`rotation=1` 后向 W 移动被挡、
  向 S 放行；`rotation=2` 后向 N 被挡。LOS 同理一条断言。

**17.2.2 【中】Mightstone 破坏确定性**
- 现状：`actions.ts:208` `Math.floor(Math.random()*6)+1`，固定 seed 下骰点不可复现。
- 期望：用 `state.rng.int(6)+1`（mulberry32，与全引擎一致）。
- 测试：同 seed 两次 `doPunch`（带 Mightstone）结果一致。

**17.2.3 【中】非 full-shield 盾牌无效**
- 现状：`conjuring-shield`/`mentalism-shield`/`ward`/`glue`/`fog`/`mist-body` 等 `op:'shield'` 卡施放后只生成
  空维持法术；`applyDamage`（damage.ts）不检查 shield。实测施放 conjuring-shield 后受 3 伤照扣（15→12）。
- 期望：盾牌形态若按 DESIGN "防护类"应能抵消下一次伤害，或按卡面 text 的具体效果。若设计定位为"反制形态"
  （须 `requiresTargetingMe` 反制），则这些卡应补 `counter` 字段而非空壳 `op:'shield'`。**以卡面 text 为准**，
  实施者逐张读 text 决定：能反制的补 counter 字段，需要即时防护的在 applyDamage 前置 hook 里生效。
- 测试：按最终语义——盾牌卡生效时目标受 1 次伤害不扣血（或反制成功时法术不结算）。

**17.2.4 【低】变形永不结束**
- 现状：`transform` op（effects.ts:214）只置 `caster.transformed`，无解除机制；permanent 变形也应受 Dispel 影响。
- 期望：临时变形按能量/回合结束换回；Dispel/negate 可解除。
- 修法：`resolveTimePasses` 对 `transformed` 的临时卡减能量、归零换回（参照 MaintainedSpell 流程）；
  `negate` 分支解除目标变形。
- 测试：变形 1 能量 → 过 1 回合后 `transformed===null`。

**17.2.5 【低】Fool's Gold 判定仍错**
- 现状：`actions.ts:845` `homeColor === other.color` 判断的是"宝藏**归属**=施放者颜色"，不是"敌人**拾取时所在格**
  =施放者 home 扇区"。规则：敌方巫师**在你的 home 扇区**捡宝藏才触发 3 伤。
- 期望：用拾取发生格判定——`p.pos.sector === other.color`（拾取者所在扇区 = Fool's Gold 施放者颜色）。
- 测试：红持 Fool's Gold，蓝在红色扇区 home 格拾宝 → 蓝受 3 伤；蓝在其他扇区拾宝 → 不受伤。

**17.2.6 【低】物品变体卡 4 张无 handler**
- 现状：`doUseItem` 只有精确 cardId 匹配，`alchemy-boomstone-3`、`alchemy-universal-solvent-2`、
  `conjuring-thornbush-2`、`conjuring-rosebush-2` 落到默认分支 → 消耗后 0 事件。
- 期望：行为与同名已实现卡一致（boomstone 爆炸伤 / solvent 溶墙门 / thornbush-rosebush 放置阻挡）。
- 修法：把 `doUseItem` 的 cardId 精确匹配改为按**前缀或卡名族**分组（如 `startsWith('alchemy-boomstone')`），
  避免每张副本重复维护。
- 测试：4 张变体各一条"使用 → 可观察效果"断言。

### 17.3 sim 胜率观察（非本批规则 bug，M6/M7 bot 策略）
- 修复后实测 8 seed 胜率 3/8，seed 42 仍 500 回合无胜者；诊断 seed 42：200 回合 10 伤 / 0 击杀 /
  pick 4 / drop 3 / VP 振荡 3。
- 根因：**LOS 修复后对角线不再穿墙，bot 远程击杀变难**；且 bot 策略凑不满 2 VP（捡到敌方宝藏后
  中途掉宝/被夺，回不了自家 home 投放）。属 §16.6 预留的 bot 策略返工。
- 后续 M6/M7 方向：HeuristicBot 拿到敌方宝藏后优先走通自家 home（强化 BFS 保送）；攻击法术在
  LOS 修复后需配合移动接近敌人再放，而非远处空放；EvolvingBot 相同。

### 17.4 复查验收
- [ ] 17.2.1-17.2.6 全部修复且有红→绿测试；typecheck/test/build 全绿。
- [ ] `npm run sim` 至少部分 seed 在 500 回合内出胜者，全 seed 不再全是 `Winner: None`。

---

## 18. AI 开发中发现的两处核心 bug（2026-08-24 Claude 写入）

> 来源：为写游戏 AI（StrategicBot，见 §19）做真实对局诊断时发现。两条都是**数据/引擎层**问题，
> 直接影响游戏公平与规则正确，**建议优先于 §16/§17 剩余项修复**。

### 18.1 卡牌类型错分类：33 张功能/移动/防护法术被标成 `attack-spell`

- **现象**：以下 33 张卡 `type:'attack-spell'`，但它们不是攻击性法术：
  ```
  alchemy-add; cantrip-drop-object / pick-lock / create-wall / rotate-sector / around-the-corner;
  conjuring-create-wall / swap / create-door / around-the-corner;
  elemental-create-wall×2 / windrider×2;
  mentalism-share-life / add×2 / pick-lock / thought-steal×2 / meditate×2;
  mutation-extra-arms×2 / wallivore×2;
  thaumaturgy-drop-object / anti-anti / pick-lock / seal-door / rotate-sector / around-the-corner / pass-through-wall
  ```
- **影响**（三处规则被破坏）：
  1. **攻击次数**：施放这些卡置 `attacked`/`attacksUsed++` → 每回合一次攻击被白费（§14.4）。
  2. **首回合禁攻击**：turn 1 施放这些"功能法术"被拒绝（R2）。
  3. **反制匹配**：只能被 `absorb-spell`（blocks `['attack-spell']`）反制，而 `negate-neutral`（blocks `['neutral-spell']`）反制不了它们——与卡面语义相反。
- **修法**：逐张按卡面 text 判类——造成伤害/攻击性效果（op `damage`、Ka-Bong、Fire Darts 等）保留 `attack-spell`；
  其余改为 `neutral-spell`（Drop Object/Pick Lock/Create Wall/Rotate Sector/Windrider/Meditate/Share Life/Add/Extra Arms/Wallivore/Pass Through Wall/Swap/Seal Door/Around the Corner/Anti-Anti）。
  `Thought Steal`（夺宝）与 `Backlash`/`Featherweight`（反制）按 text 分别归 `neutral-spell` 或 `counter-spell`。
- **测试**：`tests/cards.test.ts` 加 schema 断言——上述清单卡的 `type` 不为 `attack-spell`；
  施放 `cantrip-pick-lock` 后 `attacked===false`、turn 1 可施放。
- **已修 ✅（2026-08-24 Claude）**：33 张 → `neutral-spell`；`mutation/mentalism-featherweight`、`thaumaturgy-backlash` → `counter-spell`（backlash 补 `counter.blocks:['attack-spell'], requiresTargetingMe:true`）；`thaumaturgy-anti-anti` → `neutral-spell`（反制链 §2.7.2 预留，先可施放）。
  顺带修 bug：**被反制法术的卡之前不入弃牌堆**（`doCounter` 只入反制卡），已补 `state.discard.push(castCardId)`（actions.ts）。`tests/core/counter.test.ts` 原"countered===true"断言实为恒空断言，改为断言 `awaitingCast===null` + 两卡入弃牌堆。

### 18.2 棋盘扇区不对称：绿色扇区显著占优（绿色玩家胜率畸高）

- **现象**：4 个扇区 front 面互不为 90° 旋转对称（真实 Wiz-War 各扇区 = 同一迷宫旋转）。
  程序化比对：`blue↔green` 15 处墙/kind 不对称、`red↔yellow` 18 处不对称。
- **实测后果**（全 strategic 4-bot，maxTurns 300）：
  - 4 个相同 bot：green 10/16、yellow 5/16、blue/red 0。
  - 强 bot 单独坐 green：**8/8 胜**；坐 blue：0/8（输给 3 个弱 heuristic 或 stall）；坐 red/yellow：全 stall。
  - 反转座位顺序（green 先手）结果不变 → **不是回合顺序，是绿色扇区地形本身有利**。
- **影响**：游戏不公平；bot 进化训练结果被地形主导（进化收益被掩盖）。
- **修法（需人工判断，改动在数据层）**：
  1. 核对 `board-data.json` 提取是否正确——若 4 front 面本应旋转对称而提取错位，修正数据；
  2. 若真实棋盘确实不对称，加平衡机制（弱扇区宝藏更靠近 home / 起点优势 / 首回合先行）；
  3. 最低限度：UI 显示各扇区难度/胜率，让玩家知情选座。
- **证据脚本**：`src/headless/eval.ts`（胜率统计）；旋转对称比对逻辑见本会话诊断脚本（可重写为测试）。

### 18.3 其他记录在案（低优先级）
- 30 张 no-op 卡已清零；物品卡 4 张变体（boomstone-3 / universal-solvent-2 / thornbush-2 / rosebush-2）已按前缀分组接入（§17.2.6）。
- Universal Solvent 只能毁 `object`，不能溶墙/门（卡面 text 说"any target object (such as a wall or Thornbush)"）——M5 保真度缺口。

**18.3.1 物品卡 `target` 字段与 handler 不匹配（2026-08-24 已修）**
- 现象：6 类物品卡的 `card.target` 数据与 `doUseItem` handler 期望不一致 → `getLegalActions` 按
  `card.target` 生成的目标到 handler 里匹配不上 → **bot 用这些物品零效果**：
  | 卡 | 原 target | handler 需要 | 修复后 |
  |---|---|---|---|
  | alchemy-boomstone×3 / cantrip-large-rock / elemental-stone-spikes | square | wizard | → wizard |
  | alchemy-universal-solvent×2 | self | object | → object |
  | thaumaturgy-master-key | square | door | → door |
  | elemental-stone-block | door | cell | → square |
- 影响：修复前 bot 使用这些卡完全空放；修复后正常。
- 验收：`getLegalActions` 对每张物品卡生成的目标经 `use-item` 应用后有可观察效果（伤害/造物/开门）。
- 已修 ✅（2026-08-24 Claude，改 9 个 JSON 的 target 字段）。

---

## 19. 游戏 AI：StrategicBot + 进化训练（2026-08-24 Claude 交付）

### 19.1 新增文件
- `src/core/ai/strategic.ts`：`StrategicBot` —— 面向获胜的启发式 AI（真实棋盘、BFS 寻路、宝藏运输保送、补刀、逃跑、开锁、能量加速）。
- `src/headless/eval.ts`：多 seed 胜率评估器（`npx tsx src/headless/eval.ts <botType> [seedStart] [count] [maxTurns]`）。
- `src/headless/train.ts`：遗传算法进化训练器（`npx tsx src/headless/train.ts [generations] [pop] [gamesPerBot]`），混合人口锦标赛自博弈。
- `evolved-strategic.json`：一次训练产出的最佳权重。
- `sim.ts`：新增 `--strategic` 选项。

### 19.2 评估结果（多 seed，maxTurns 300）
| 组合 | 胜局 | stall | 平均回合 | 胜者分布 |
|---|---|---|---|---|
| heuristic ×4 | 5/12 | 7 | 204 | red 4, yellow 1 |
| **strategic ×4** | **15/16** | 1 | **65** | green 10, yellow 5 |
| random ×4 | 0/12 | 12 | 300 | - |

StrategicBot 相对 heuristic：胜率 5/12 → 15/16，平均回合 204 → 65，stall 大减。

### 19.3 关键设计
- **携带宝藏 = 最高优先级**：直接 BFS 回自家 home 投放，中途不停顿（不打架、不捡宝、不施法），除非被门挡（开锁）。
- **寻宝 = 主动**：追最近**可达**的敌方宝藏（BFS 过滤不可达），抖动打破同质化，偏好参数可调。
- **战斗 = 补刀/夺宝**：攻击低血或携带宝藏的相邻敌人；健康时对 LOS 内最弱敌人放伤害法术。
- **保命**：低血时逃离威胁。
- 训练权重接口：`StrategicWeights`（9 参数），`train.ts` 用混合人口锦标赛自博弈进化。

### 19.4 已知局限（与 §18.2 相关）
- 因棋盘绿色扇区占优（§18.2），**全同质 strategic 局绿色垄断胜场**；训练收益被地形掩盖。
  修复 §18.2（棋盘对称）后，进化训练才有意义。当前 strategic 已显著优于 heuristic，可直接使用。

### 19.5 测试
- 新增：strategic 4-bot 局在 maxTurns 内结束（无死循环/stall），且对 heuristic 有正胜率（受棋盘不平衡影响，断言放宽）。

---

## 20. 进度交接（2026-08-24 Claude → qwen 续接）

> 当前全绿：**122 测试 / typecheck / build 全过**。HEAD 仍为 M9（`e1cc4a3`），**本批改动未提交**。
> 按 §20.1 已完成的不要再动；按 §20.2 的优先级继续。每条仍是"当前红→修后绿"。

### 20.1 本会话已完成（勿重复）
1. **规则修复**：§16（S1-S4 + 高优先级 5 项）、§17.2（六项）、§18.1（卡类型 36 张）。
2. **物品卡 target 修正**（§18.3.1）：9 个 JSON 的 `target` 与 `doUseItem` handler 对齐。
3. **被反制法术卡入弃牌堆**（actions.ts `doCounter` 补 `state.discard.push(castCardId)`）。
4. **游戏 AI**：`src/core/ai/strategic.ts`（StrategicBot）、`src/headless/eval.ts`、`src/headless/train.ts`、`src/headless/logger.ts`、`evolved-strategic.json`、sim 加 `--strategic`/`--record`。
   实测：strategic ×4 = 16 seed 15/16 胜、avg 65 回合（heuristic = 8/16、183 回合）。
5. **测试**：新增 `tests/core/real-topology.test.ts`、`tests/headless/strategic.test.ts`；修正 `counter.test.ts` 恒空断言 + 反制断言。

### 20.2 未完成（按优先级，qwen 续做）

**P0 §18.2 棋盘扇区不对称（绿色占优）——需要你调查并修**
- 现象与证据见 §18.2：4 front 面互不为 90° 旋转对称；全同质 strategic 局 green 10/16；强 bot 坐绿 8/8、坐蓝 0/8、坐红/黄全 stall；反转座位顺序结果不变。
- **调查方向**（选一后实现）：
  ① 核对 `src/board-data.json` 提取是否正确——真实 Wiz-War 各扇区 front 应为同一迷宫旋转。若提取错位，修正数据（可对比 `work/board-data.json` 与 `scripts/extract_board_vision.py`）。
  ② 若真实棋盘确实不对称，加**坐席平衡机制**：给弱扇区（蓝/红/黄）补偿（如宝藏更靠近 home、起点多 1 个能量、home 更靠近中心）。
  ③ 最低限度：在 UI/sim 显示各扇区胜率统计，标注难度。
- **验收**：全同质 strategic ×4（≥12 seed）胜者分布不再被单扇区垄断（任一颜色占比 < 60%）；强 bot 坐任何座位都有正胜率。

**P1 物品保真度（§18.3）**
- Universal Solvent 应能溶墙/门（text："any target object (such as a wall or Thornbush)"），当前只毁 `object`。
- 投掷物（Boomstone/Large Rock/Stone Spikes）应能打 object/creature，当前只打 wizard。
- 修法：`doUseItem` 对应 handler 扩展目标类型；测试补"打墙/门/object"断言。

**P2 人类可玩 UI（目标选择）**
- 交互式选目标机制在遗留 `src/client/ui.ts`（热座 GameUI），但 `main.ts` 只接 AI 旁观 `Battle`。
- 选项：① 把热座 GameUI 重接回 main.ts（加"人类 vs AI"座位选项）；② 给 Battle UI 加"旁观介入"（点某 bot 手牌+格子替它选动作）。
- 修法：复用现有 `computeHighlights`/`handleCellClick`/`board-view` 高亮；`battle.ts` 的 `afterAction` 回调里留人工输入窗口。

**P3 收尾**
- 提交：把工作区按逻辑分几个 commit（规则修复 / 卡数据 / AI / 测试 / 文档），commit message 带 milestone 说明。
- USAGE.md / PROJECT_REPORT.md 更新：sim `--strategic`、`--record`、eval、train 用法。

### 20.3 关键运行命令（验证用）
- 测试：`npm test`（122）；类型：`npm run typecheck`；构建：`npm run build`。
- AI 对战：`npx tsx src/headless/sim.ts <seed> --strategic`。
- 评估：`npx tsx src/headless/eval.ts <botType> <seedStart> <count> <maxTurns>`。
- 记录对局：`npx tsx src/headless/sim.ts <seed> --strategic --record=logs`。
- 进化训练：`npx tsx src/headless/train.ts <gens> <pop> <gamesPerBot>`。
