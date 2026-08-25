# AGENTS.md — Wiz-War 数字版

> 这份文件是给每个新 session 的**启动器**，不是详细报告。
> 目标是让你**不用从零考古**就能开工。先读"当前状态"和"进行中的任务"，其他按需再查。
> 会话结束时，把新结论/进度更新到「当前状态」段和 IMPLEMENTATION_PLAN 的对应交接节，供下个会话续接。

## 项目一句话

Wiz-War（巫师大战）桌游的 Web 数字版：**纯 TypeScript 规则引擎**（同步纯函数）+ **React 19 + Tailwind 4 客户端** + 无头模拟/AI 对战（StrategicBot + 进化训练）。保留真实棋盘扫描图，支持 Human vs AI。

## 权威文档（按优先级，**别整篇重读**）

- `IMPLEMENTATION_PLAN.md` — **唯一实施真相源**（1181 行）。开工先读 §20（进度交接）和 §21（UI 重构方案）的**状态/验收段**，不要从头通读。§20.1/§21.5 已完成项 = 勿重复做。
- `DESIGN.md` — 规则与设计总览。
- `USAGE.md` — 运行方式与命令。
- `AGENTS.md`（本文件）— 当前状态 + 已确认决策 + 工程红线。

## 当前状态（2026-08-25）

- **§21 React UI 现代化：Phase 0–4 全部完成并已提交**（`82fd22d`→`b777d0d`）：mock 原型 → React 基础设施+战场 → VFX 事件驱动 → HumanInput 真交互 → 打磨。React 组件在 `src/client/components/`，入口 `src/client/main.tsx`。
- 核心 125 测试全绿（`tests/` 现有 127 个 test/it），typecheck / build 通过。HEAD = `b777d0d`。
- **边缘直连已实现**：走出棋盘外缘经开口（无墙）环绕到对边（上↔下、左↔右），见「进行中的任务」。
- Web 端与无头 sim 都默认 **StrategicBot**（`--heuristic` 保留旧 bot）。施法免费动作，优先级"先施法再移动"。物品可从**手牌或携带物**使用。

## 进行中的任务（2026-08-25，最新）

**朝地图外的门 = 边缘直连**（✅ 已实现，待提交）：

- 规则确认：**地图外边缘的门直接相连——上↔下（N-S 纵向直连）、左↔右（E-W 横向直连）。不是符文门，也不是成对传送门。**
- 实现：`moveDestination`（`src/core/board.ts:274`）走出板边时不再返回 `null`，而是**环绕**到对边（同行/同列），仅当出口与入口都无墙（即"门"开口）时放行。真实棋盘外缘每边 index=2 处有开口（front/back 一致）。
- 测试：`tests/core/board.test.ts` 新增环绕用例 + 改"板边阻挡"为"有墙才挡"。125 测试全绿，typecheck 通过，sim 正常。

## 已确认的规则/决策（别推翻、别重问）

- 核心层**保持同步纯函数**，异步驱动独立成层（§2.1）。
- `getLegalActions` 是合法动作的**唯一事实源**（§2.5）；Human 交互高亮复用它。
- 反制：施法免费，反制成功后法术卡进弃牌堆；`awaitingCast` 不要残留。
- 门穿过即重锁（R3）；关着的门挡 LOS（R4）；跨扇区移动做边界检查（R1）。
- 眩晕规则 = **移动 OR 攻击，二选一**（不是都做）。
- 手牌超限强制弃牌（R7）；能量语义见 §2.6。
- 卡牌类型以 `src/core/cards/data/*.json` 为准；§18.1 已修过 33 张 `attack-spell` 错分类，勿改回。

## 已知未决问题（按优先级）

- **P0 §18.2 棋盘扇区不对称**：绿色扇区显著占优（强 bot 坐绿 8/8、坐蓝/红/黄 0 胜）。根治方向 = 核对/修正 `src/board-data.json` 使 4 个 front 面为同一迷宫旋转（可对比 `work/board-data.json` 与 `scripts/extract_board_vision.py`）；或大幅坐席补偿。验收：全同质 strategic ×4（≥12 seed）任一颜色占比 < 60%。
- P1 物品残留小问题：毁坏 object 不移出数组；Large Rock 打 object 不产生 GameEvent。
- §20.6 遗留：CSS 墙线（`.board__cell--wall-*`）与图片墙仍双画，待用户确认观感后再决定是否去掉。

## 工程红线

- 改动核心必须保持 **124 测试全绿 + `npm run typecheck` 通过**。
- 每条规则改动按"当前红 → 修后绿"验证，先写/改测试再实现或同步。
- 提交按逻辑分组（规则修复 / 卡数据 / AI / 测试 / 文档），message 带 milestone 说明。
- 不要为"好看"重构已交付且验证过的代码；§21 死代码清理范围以 §21.4 为准。

## 常用命令

| 用途 | 命令 |
|---|---|
| 测试 | `npm test`（vitest） |
| 类型检查 | `npm run typecheck` |
| 构建 | `npm run build` |
| 开发 | `npm run dev`（UI 评审原型：`npm run dev:mock` → `/prototype.html`） |
| AI 对战模拟 | `npx tsx src/headless/sim.ts <seed> --strategic` |
| 评估 | `npx tsx src/headless/eval.ts <botType> <seedStart> <count> <maxTurns>` |
| 记录对局 | `npx tsx src/headless/sim.ts <seed> --strategic --record=logs` |
| 进化训练 | `npx tsx src/headless/train.ts <gens> <pop> <gamesPerBot>` |

## 给每个新 session 的工作协议

1. 先 `git log --oneline -15` + `git status` 看最近提交与工作区。
2. 读本文件「当前状态 / 进行中的任务」→ 再按需读 IMPLEMENTATION_PLAN §20/§21 对应节。**不要从头重读 plan。**
3. 复述一遍你理解的任务与验收标准，再动手（避免理解偏差）。
4. 完成后把进度/决策更新回本文件「当前状态」和 IMPLEMENTATION_PLAN 交接节，再提交。
