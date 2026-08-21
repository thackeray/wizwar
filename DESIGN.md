# Wiz-War Web 版 — 设计文档

> 状态：设计定稿，等待图像处理完成后开始实现
> 日期：2026-08-21

## 1. 范围决策（已确认）

| 项目 | 决策 |
|---|---|
| 对战模式 | 本地热座（hot-seat，同一浏览器轮流操作） |
| 卡牌范围 | 基础 7 学派（Cantrip/Alchemy/Conjuring/Elemental/Mentalism/Mutation/Thaumaturgy），共 168 张 |
| AI | 内置 bot（实现与人类玩家相同的接口，可填充空位） |
| 技术栈 | TypeScript + Vite + Vitest + Playwright；纯前端（暂不需要 Node 服务端） |
| 扩展 | Malefic Curses / Bestial Forces 暂不实现，但架构预留（学派=数据，加扩展=加数据） |

## 2. 目录结构

```
wizwar/
├── DESIGN.md               # 本文档
├── package.json
├── vite.config.ts
├── index.html
├── assets/
│   ├── boards/             # 4 张扇区棋盘 PNG（用户提供，重处理版）
│   │   ├── blue.png  red.png  yellow.png  green.png
│   └── tokens/             # 可选：token 小图（帽子/裂缝/能量/眩晕/宝藏/传送门）
├── src/
│   ├── core/               # ★ 纯逻辑引擎，零 UI 依赖，全部可单测
│   │   ├── types.ts        # 所有类型定义
│   │   ├── state.ts        # GameState 构造/序列化
│   │   ├── rng.ts          # 可播种 RNG（mulberry32），保证可复现
│   │   ├── board.ts        # 棋盘拓扑、移动合法性、LOS、传送门、绕边
│   │   ├── turn.ts         # 回合三阶段流程
│   │   ├── actions.ts      # 所有玩家动作的校验+应用（唯一入口）
│   │   ├── damage.ts       # 伤害/裂缝/死亡/VP 结算
│   │   ├── cards/
│   │   │   ├── schema.ts   # 卡牌 JSON schema + 校验
│   │   │   ├── registry.ts # 卡牌注册表（内置+自定义合并）
│   │   │   ├── effects.ts  # 效果解析器（effect → 状态变更）
│   │   │   └── data/       # 7 个学派的卡牌 JSON
│   │   │       ├── cantrip.json  alchemy.json  conjuring.json
│   │   │       ├── elemental.json  mentalism.json
│   │   │       ├── mutation.json  thaumaturgy.json
│   │   └── ai/
│   │       ├── interface.ts  # AIPlayer 接口
│   │       └── bots.ts       # 内置 bot（随机/启发式）
│   ├── client/             # Web UI（热座）
│   │   ├── main.ts         # 入口
│   │   ├── ui.ts           # 渲染（棋盘/手牌/玩家面板/日志）
│   │   ├── board-view.ts   # 棋盘 PNG + 网格叠加 + token 定位
│   │   ├── card-view.ts    # 卡牌 HTML/CSS 渲染（不依赖卡牌图片）
│   │   └── hotseat.ts      # 热座流程控制（回合切换提示）
│   └── headless/
│       └── sim.ts          # 无头对局运行器（AI vs AI 整局模拟）
├── tests/
│   ├── core/               # 引擎单元测试
│   ├── cards.test.ts       # 卡牌 schema 校验 + 效果冒烟
│   └── e2e/                # Playwright 浏览器测试
└── scripts/
    └── extract-board.py    # 从棋盘 PNG 提取拓扑（墙/门/家/宝藏/传送门）
```

## 3. 核心引擎设计

### 3.1 状态模型

```ts
interface GameState {
  seed: number;
  rng: RNG;
  players: PlayerState[];        // 2-4 人
  board: BoardState;
  deck: string[];                // 卡牌 id 列表（洗好的）
  discard: string[];
  currentPlayer: number;
  turnNumber: number;            // 全局回合数（首回合禁止攻击）
  phase: 'time-passes' | 'move-cast' | 'discard-draw';
  winner: number | null;
  log: LogEntry[];               // 完整事件日志（回放/AI 用）
}

interface PlayerState {
  id: number;
  color: 'blue'|'red'|'yellow'|'green';
  isBot: boolean;
  life: number;                  // 初始 15，上限 20
  vp: number;
  pos: CellRef;                  // 所在格
  hand: string[];                // 手牌（卡牌 id）
  carriedItems: string[];        // 携带物品
  carriedTreasure: number | null;
  maintainedSpells: MaintainedSpell[];  // 临时/永久法术
  mp: number;                    // 本回合剩余 MP
  speedBoosted: boolean;         // 本回合是否已用能量加速
  attacked: boolean;
  stunned: boolean;
  stunTokens: number;
  alive: boolean;
  transformed: string | null;    // 变形法术 id
}

interface MaintainedSpell {
  cardId: string;
  energy: number;                // 剩余能量 token 数
  target: TargetRef;             // 目标（巫师/格/墙等）
  owner: number;
}
```

### 3.2 动作系统（唯一入口）

所有操作走 `applyAction(state, action): Result`，内部校验合法性：

```ts
type Action =
  | { type: 'move'; dir: 'N'|'S'|'E'|'W' }          // 1 MP
  | { type: 'punch'; target: number }               // 相邻，1 伤害
  | { type: 'cast'; cardId: string; target?: TargetRef; energyCard?: string }
  | { type: 'use-item'; cardId: string; target?: TargetRef }
  | { type: 'pick-up-object' }
  | { type: 'drop-item'; cardId: string }
  | { type: 'pick-up-treasure' }                    // 立即结束 Move&Cast
  | { type: 'drop-treasure' }
  | { type: 'end-spell'; index: number }
  | { type: 'discard'; cardIds: string[] }
  | { type: 'draw'; count: number }
  | { type: 'boost-speed'; cardId: string }
  | { type: 'counter'; cardId: string; spellIndex: number }  // 响应式反制
  | { type: 'end-turn' };
```

- 每次动作返回 `{ ok: true, events }` 或 `{ ok: false, reason }`
- 事件（events）驱动 UI 动画与日志，也供 AI 观察
- 反制法术（counter spell）：施法动作发出后进入 `awaiting-counter` 子状态，其他玩家可响应

### 3.3 棋盘模型

```ts
interface BoardState {
  sectors: Record<Color, SectorState>;   // 4 个扇区
  portals: PortalDef[];                  // 传送门配对
}
interface SectorState {
  color: Color;
  rotation: number;                      // 0-3，Rotate Sector 用
  grid: Cell[8][8];
}
interface Cell {
  kind: 'corridor'|'home'|'treasure-start';
  walls: { N: boolean; S: boolean; E: boolean; W: boolean };  // 静态墙
  doors: { N?: Door; S?: Door; E?: Door; W?: Door };          // 颜色门
  dynamicWalls: { N?: WallToken; ... };   // 法术创建/破坏的墙
  objects: DroppedObject[];               // 掉落物品
  treasures: number[];                    // 宝藏标记（玩家 id）
}
```

- 移动：4 方向，不可斜行；穿墙/锁门/占满格（stone block 等）阻挡
- 绕边：走出开放边缘 → 对侧重入，耗 1 MP
- 传送门：走出带传送门的边缘 → 从同色传送门重入，耗 1 MP
- LOS：中心点连线，被墙（含柱）阻挡；可穿过物品/巫师/宝藏；
  目标为墙/门时须直接可见；传送门/绕边两侧视为相邻
- 门：默认锁；自己颜色的门对自己视为开；穿过即关（除非 hold-open）；
  关着的门挡 LOS

### 3.4 回合流程

```
Time Passes:
  1. 结算 "when time passes" 效果（酸浴伤害、火墙等）
  2. 每个维持中的临时法术 -1 能量，归零则移除
  3. 有眩晕 token → 移除 1 个，本回合眩晕（只能移动或攻击，二选一）
Move & Cast（任意顺序）:
  - 3 MP（基础速度，变形可改）
  - 1 次攻击（首回合全局禁止；攻击法术/武器/拳击三选一）
  - 任意数量法术/物品/能量卡
  - 拾取宝藏 → 立即结束本阶段
Discard & Draw:
  - 弃任意张 → 抽至多 2 张（手牌上限 7，含携带物品+维持法术）
  - 超限立即弃到上限
```

### 3.5 胜利条件

- 任一玩家 VP ≥ 2 → 立即获胜
- 杀敌 +1 VP（直接攻击致死）；间接致死无 VP
- 敌方宝藏停在自己 home 格 → 该宝藏 +1 VP（移走即失）
- 唯一存活巫师 → 获胜

## 4. 卡牌框架（支持自定义）

### 4.1 卡牌 JSON Schema

```jsonc
{
  "id": "acid-bath",              // 唯一 id
  "name": "Acid Bath",
  "school": "alchemy",            // 学派
  "type": "attack-spell",         // attack-spell | counter-spell | neutral-spell
                                   // | item | energy | transform
  "energy": 1,                    // 基础能量（临时法术持续时间）
  "range": "los",                 // caster | adjacent | los | anywhere | same-sector
  "duration": "temporary",        // instant | temporary | permanent
  "target": "wizard",             // wizard | creature | object | square | wall
                                   // | door | self | game-board | spell | line
  "energyValue": 0,               // 蓝圈：可当能量卡用的数值（0=不可）
  "text": "Drench target wizard...",  // 展示文本
  "effect": { ... }               // ★ 机器可读效果（见下）
}
```

### 4.2 效果 DSL（effect 字段）

声明式效果树，resolver 递归执行：

```jsonc
// 示例：Acid Bath
{ "op": "apply-spell",
  "damage": { "kind": "magical", "amount": 2, "when": "time-passes" },
  "counts-as-attack": true,
  "ends-if": { "op": "target-affected-by", "school": "water" } }

// 示例：Fireball
{ "op": "damage", "kind": "magical", "amount": 3,
  "targets": "all-in-range", "cannot-evade": false }

// 示例：Create Wall
{ "op": "create-object", "object": "wall", "duration": "with-spell" }

// 示例：Teleport
{ "op": "teleport", "ignore": ["walls","doors","objects","hexes"] }
```

- 内置 op 集：`damage / heal / apply-spell / create-object / destroy-object /
  teleport / move-random / stun / draw / discard / steal-treasure /
  transform / shield / negate / absorb / rotate-sector / seal-door /
  pick-lock / drop-object / swap-positions / share-life / ...`
- 自定义卡牌 = 新增 JSON（可用已有 op 组合）；需要新 op 时在 `effects.ts` 注册
- `registry.ts` 启动时合并：内置 JSON + `custom/` 目录 JSON，schema 校验报错即拒绝

### 4.3 基础 7 学派卡表（168 张，来自 components 清单）

| 学派 | 卡牌（×数量） |
|---|---|
| Cantrip (White) | Full Shield, Negate Neutral, Drop Object, Zot, Around the Corner, Create Wall, Destroy Wall, Dispel, Pick Lock, Rotate Sector, Large Rock, Energy 6 |
| Alchemy | Fool's Gold, Acid Bath×2, Stone Dead, Add, Homunculus, Bloodshard, Boomstone×3, Brainstone, Lifestone, Mightstone, Null Powder, Powerstone×2, Speedstone×2, Spellstone, Universal Solvent×2, Visionstone, Energy 4, Energy 5 |
| Conjuring | Negate Neutral, Shield×2, Wall of Earth, Ward, Fire Darts, Ka-Bong×2, Swap, Around the Corner, Booby Trap, Create Door, Create Wall, Dispel, Dust Cloud, Glue, Rosebush×2, Thornbush×2, Handful of Tacks, Energy 4×2, Energy 5 |
| Elemental | Wall of Earth×2, Fireball×3, Lightning Bolt×2, Waterbolt×2, Flood, Wall of Fire, Create Wall×2, Destroy Wall, Fog, Mist Body, Stone Block, Stone Spikes, Windrider×2, Fire Clock, Energy 4×2, Energy 5 |
| Mentalism | Absorb Spell, Shield, Brain Burn×2, Mental Force×2, Powerthrust×2, Psychic Storm, Share Life, Thought Steal×2, Pain Link×2, Teleport, Add×2, Astral Projection×2, Meditate×2, Pick Lock, Shatter, Energy 4 |
| Mutation | Featherweight×2, Disease, Heave-Ho, Gnome Form, Stretch×2, Adrenaline×2, Big Man Form, Dispel, Extra Arms×2, Golem Form, Mad Dash, Mist Body, Slime Form, Strength, Wallivore×2, Werewolf Form, Energy 4×2, Energy 5 |
| Thaumaturgy | Anti-Anti, Backlash, Full Shield, Negate Neutral, Drop Object, Fire Darts, Globe of Pain×2, Powerthrust, Slow Death, Yoink, Invisible, Around the Corner, Dispel, Gravity, Pass Through Wall, Pick Lock, Rotate Sector, Seal Door, Master Key, Dagger, Wizardblade, Energy 5×2 |

- 开局：White Cantrip 全入池 + 玩家选 3 个学派 → 混洗成牌库
- 卡牌效果文本：实现时逐张 OCR 提取（cards.zip 已有全部图）

## 5. AI 接口

```ts
// 内置 bot 与未来外部 AI 的统一接口
interface AIPlayer {
  name: string;
  // 观察状态 → 决定动作（同步或异步）
  chooseAction(state: PublicState, legalActions: Action[]): Promise<Action>;
  // 反制响应
  chooseCounter?(state: PublicState, pendingSpell: CastInfo): Promise<CounterDecision>;
}
```

- `PublicState`：脱敏视图（bot 看不到别人手牌，与真实玩家信息对称）
- 内置 bot 两档：
  - `random-bot`：合法动作里随机选（用于测试/占位）
  - `heuristic-bot`：简单启发式（保命/追 VP/有攻击就打/有门就开）
- 热座 UI 中每个座位可选「人类」或「bot」
- 预留：`headless/sim.ts` 可被外部脚本调用（未来接外部 AI 的入口）

## 6. 客户端（热座 UI）

- 棋盘：4 张扇区 PNG 拼 2×2（按玩家数 2/3/4 布局），叠加 8×8 网格坐标层
- 交互：
  - 点格子移动 / 点卡牌施法（选目标高亮合法目标）
  - 手牌区（当前玩家可见，切换玩家时翻面）
  - 玩家面板：生命/VP/MP/眩晕/变形/携带物
  - 事件日志 + 回合提示（"轮到 X，请传递设备"）
- 卡牌渲染：纯 HTML/CSS（名称/学派色/能量圈/文本），不依赖卡牌图片
- 状态同步：UI 只读 `GameState` + 订阅 events，重渲染（单向数据流）

## 7. 图像处理需求（等你处理）

**必需**：
1. 4 张扇区棋盘**正面** PNG（blue/red/yellow/green），要求：
   - 正方形、无外框装饰、8×8 网格与图片边缘对齐（每格等分）
   - 分辨率 ≥ 1024×1024
   - 放到 `assets/boards/`
2. 我会用 `scripts/extract-board.py` 从图中自动提取拓扑
   （墙/门颜色/家/宝藏格/传送门位置），生成 `board-data.json`，
   再人工抽查核对

**可选**：
- token 小图（帽子/裂缝/能量/眩晕/宝藏/传送门/物品标记）→ `assets/tokens/`
- 没有的话我用 CSS 画简易标记

## 8. 验证方案（我能操控+验证）

1. **单元测试**（Vitest）：
   - 移动/LOS/传送门/绕边
   - 回合流程、MP、手牌上限
   - 伤害/裂缝/死亡/VP
   - 每种卡牌效果冒烟测试
   - 卡牌 schema 校验（168 张全过）
2. **无头整局模拟**：
   - `npm run sim`：4 个 bot 打完整局，断言正常结束、状态一致、无死循环
   - 固定 seed 可复现
3. **E2E**（Playwright）：
   - 开热座局 → 人类操作移动/施法 → bot 响应 → 流程不卡死
4. **手动**：浏览器里热座玩一局

## 9. 实施里程碑

| # | 任务 | 依赖 |
|---|---|---|
| M1 | 工程脚手架（Vite+TS+Vitest）+ core 类型 + RNG | 无 |
| M2 | 棋盘模型 + 移动/LOS/传送门 + 单测 | 无（拓扑可先用占位数据） |
| M3 | 回合流程 + 基础动作（移动/拳击/弃抽）+ 单测 | M1,M2 |
| M4 | 卡牌框架（schema/registry/effects）+ 168 张卡数据（OCR 提取文本） | M1 |
| M5 | 法术效果全实现 + 单测 | M3,M4 |
| M6 | 内置 bot + 无头模拟 | M3,M5 |
| M7 | 热座 UI（棋盘/手牌/面板/日志） | M3,M5 |
| M8 | 棋盘拓扑提取（等你的图）+ 核对 | 图就绪 |
| M9 | E2E + 整局联调 + 修 bug | 全部 |

## 10. 规则要点备忘（实现时对照）

- 生命 15 起，上限 20；≤0 死亡出局，掉落携带物，宝藏留下
- 每 3 点伤害 = 1 裂缝；石墙 5 裂缝、门 3 裂缝、外墙/宝藏/未注明物品不可破坏
- 能量卡：可加速移动（每回合 1 次）或加燃料法术（替换能量值，非叠加）
- 临时法术：能量 token 数 = 持续时间，自己 Time Passes 阶段 -1
- 维持法术/携带物品占手牌上限（7）；宝藏不占
- 眩晕：本回合只能移动或攻击（二选一），不能主动离开当前格
- 变形：换棋子，速度/能力按卡面，结束换回
- 首回合（全局 turn 1）禁止一切攻击
- 门：自己颜色=开；穿过即关；hold-open 需相邻保持；关门挡 LOS
- 绕边/传送门两侧视为相邻且通 LOS
- 法术不能在 home 格或已有物/宝藏/生物的格上造物
- 直接攻击杀敌 +1 VP 并收其手牌；间接杀无 VP