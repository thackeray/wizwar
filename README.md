# Wiz-War Digital

A browser-based digital adaptation of the **Wiz-War** board game — a pure TypeScript rule engine + React UI + headless AI battles.

> ⚠️ This is a fan-made digital adaptation. Wiz-War is a published board game; this project does **not** bundle the original rulebook or artwork scans.

## Features

- **Pure TypeScript rule engine** — synchronous, side-effect-free core (`src/core/`) that is fully unit-testable.
- **React 19 + Tailwind 4 client** — board, hand, player panels, event log, VFX, and human input.
- **Human vs AI** — pick a school loadout and play against `StrategicBot`.
- **AI battles & training** — headless simulation, evolutionary training, and bot evaluation.
- **Real board topology** — walls/doors/home/treasure extracted from the actual boards (`src/board-data.json`).
- **168 cards across 7 schools** — Cantrip, Alchemy, Conjuring, Elemental, Mentalism, Mutation, Thaumaturgy.

## Tech stack

TypeScript · Vite · React 19 · Tailwind 4 · Vitest · Playwright · tsx

## Getting started

```bash
npm install
npm run dev        # start the dev server (http://localhost:5173)
npm test           # run the test suite (154 tests)
npm run typecheck  # type check
npm run build      # production build
```

### Play

1. Open the dev server.
2. Pick a mode: **AI vs AI (Spectate)** or **Human vs AI**.
3. Choose 3 schools (Cantrip is always included), then **Start Game**.
4. Move by clicking highlighted cells, cast from your hand, and end your turn in the Discard & Draw phase.

### Headless simulation / AI

```bash
npx tsx src/headless/sim.ts 42 --strategic            # run one battle (seed 42)
npx tsx src/headless/eval.ts strategic 0 8 300        # evaluate a bot's win rate
npx tsx src/headless/train.ts 10 20 10                # evolutionary training
```

## Project structure

```
src/core/          Pure rule engine (board, actions, damage, turn, cards, AI)
src/client/        React UI
src/headless/      Simulation, evaluation, and training
tests/             Unit tests (core, headless, e2e)
scripts/           Board-topology extraction & card data tooling
```

## Notes

- The full board/card **scans live only in `public/images/` on the local machine** (654 MB, git-ignored). Without them the UI renders CSS-drawn board/cards as a fallback, so a fresh clone runs fine.
- The rulebook PDF/DOCX are intentionally **not** distributed in this repository.

## License

MIT — see [LICENSE](LICENSE).

---

## 中文简介

Wiz-War 桌游的浏览器数字版：纯 TypeScript 规则引擎 + React 19 + Tailwind 4 客户端 + 无头 AI 对战。支持 人类 vs AI、AI 对战观摩、进化训练。核心 154 测试全绿。这是一个同人改编项目，**不包含原版规则书与美术扫描图**。
