# Wiz-War 项目报告

## 项目概述

Wiz-War 是一款基于桌游《Wizards》规则的数字版策略卡牌游戏，支持 2-4 人对战，包含人类玩家和 AI 对手。

## 技术架构

### 技术栈
- **语言**: TypeScript
- **构建工具**: Vite
- **测试框架**: Vitest + Playwright
- **运行环境**: Node.js 22+

### 目录结构
```
src/
├── core/           # 核心游戏逻辑（无 UI 依赖）
│   ├── board.ts    # 棋盘模型（10x10，4个5x5扇区）
│   ├── board-data.ts # 棋盘数据转换
│   ├── state.ts    # 游戏状态管理
│   ├── actions.ts  # 行动处理
│   ├── turn.ts     # 回合流程
│   ├── damage.ts   # 伤害计算
│   ├── types.ts    # 类型定义
│   ├── rng.ts      # 随机数生成
│   ├── cards/      # 卡牌系统
│   │   ├── effects.ts    # 效果解析器
│   │   ├── registry.ts   # 卡牌注册表
│   │   ├── schema.ts     # 卡牌模式
│   │   └── data/         # 7学派卡牌数据
│   └── ai/         # AI 系统
│       ├── bots.ts       # 基础AI（随机/启发式）
│       └── evolving.ts   # 自进化AI
├── client/         # 浏览器客户端
│   ├── main.ts     # 入口点
│   ├── ui.ts       # UI 组件
│   ├── board-view.ts # 棋盘渲染
│   ├── card-view.ts  # 卡牌渲染
│   └── hotseat.ts    # 热座模式
├── headless/       # 无头模式
│   ├── sim.ts      # AI对战模拟器
│   └── evolve.ts   # AI进化脚本
└── board-data.json # 真实棋盘拓扑数据
```

## 核心功能

### 1. 棋盘系统
- **尺寸**: 10x10 全局棋盘，由 4 个 5x5 扇区组成
- **扇区布局**:
  - 蓝色: 左上 (0,0)
  - 红色: 右上 (0,5)
  - 黄色: 左下 (5,0)
  - 绿色: 右下 (5,5)
- **特性**:
  - 数据驱动拓扑（从 board-data.json 加载）
  - 墙壁/门系统
  - 传送门支持
  - 视线(LOS)计算

### 2. 卡牌系统
- **7个学派**: Cantrip, Alchemy, Conjuring, Elemental, Mentalism, Mutation, Thaumaturgy
- **卡牌数量**: 128 张
- **卡牌类型**:
  - 攻击法术 (attack-spell)
  - 反制法术 (counter-spell)
  - 中性法术 (neutral-spell)
  - 物品 (item)
  - 能量 (energy)
  - 变形 (transform)
- **效果系统**: 支持 20+ 种操作
  - 伤害/治疗
  - 传送/眩晕
  - 创建/破坏物体
  - 旋转扇区
  - 开锁/封门
  - 等等

### 3. AI 系统

#### 基础 AI
- **RandomBot**: 随机选择行动
- **HeuristicBot**: 基于简单启发式策略
  - 优先攻击相邻敌人
  - 有视线时施放攻击法术
  - 向最近敌人移动

#### 自进化 AI
- **EvolvingBot**: 参数化策略AI
  - 10 个可调参数（攻击性、防御性、寻宝倾向等）
  - 基于评分系统选择行动
- **GeneticEvolver**: 遗传算法进化
  - 种群大小: 可配置（默认20）
  - 变异率: 可配置（默认0.1）
  - 锦标赛选择
  - 精英保留

### 4. 游戏流程
1. **Time Passes**: 回合开始，处理持续效果
2. **Move & Cast**: 移动和施放法术（3 MP）
3. **Discard & Draw**: 弃牌和抽牌

## 测试覆盖

- **单元测试**: 40 个测试全部通过
  - 棋盘拓扑测试
  - 卡牌效果测试
  - 游戏状态测试
- **类型检查**: TypeScript 严格模式
- **构建**: 生产构建成功

## 性能指标

- **构建时间**: ~400ms
- **测试时间**: ~60ms
- **包大小**: 102KB (gzip: 22KB)

## 已知限制

1. 部分卡牌效果未完全实现（标记为 no-op）
2. E2E 测试配置存在但无实际测试用例
3. 自进化AI的匹配评估使用启发式而非完整游戏模拟

## 未来改进方向

1. 完善所有卡牌效果实现
2. 添加 E2E 测试
3. 优化自进化AI的匹配评估
4. 添加网络对战支持
5. 改善 UI/UX