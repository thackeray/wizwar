// Headless game runner: AI vs AI full game simulation.

import { createBoard } from '../core/board';
import { createGameState } from '../core/state';
import { startTurn, endTurn } from '../core/turn';
import { applyAction } from '../core/actions';
import { loadBuiltInCards } from '../core/cards';
import { buildDeck } from '../core/cards/registry';
import { HeuristicBot, RandomBot, getLegalActions, type AIPlayer } from '../core/ai/bots';
import type { GameState, Color, School } from '../core/types';

export interface SimConfig {
  seed: number;
  playerColors: Color[];
  botTypes: ('heuristic' | 'random')[];
  maxTurns?: number;
}

export interface SimResult {
  winner: number | null;
  turns: number;
  log: string[];
  finalState: GameState;
}

function makeBot(type: 'heuristic' | 'random'): AIPlayer {
  return type === 'heuristic' ? new HeuristicBot() : new RandomBot();
}

export async function runSimulation(config: SimConfig): Promise<SimResult> {
  loadBuiltInCards();
  const board = createBoard();
  const schools: School[] = ['cantrip', 'alchemy', 'elemental', 'mentalism'];
  const deck = buildDeck(schools);

  const state = createGameState(
    {
      seed: config.seed,
      playerColors: config.playerColors,
      botSeats: config.playerColors.map(() => true),
      schools,
      cantripSchool: 'cantrip',
    },
    board,
    deck,
  );

  const bots = config.botTypes.map(makeBot);
  const maxTurns = config.maxTurns ?? 500;

  let turns = 0;
  while (state.winner === null && turns < maxTurns) {
    turns++;
    const p = state.players[state.currentPlayer];
    const bot = bots[state.currentPlayer];

    // Start turn.
    startTurn(state);
    if (state.winner !== null || !p.alive) continue;

    // Bot takes actions until it ends its turn.
    let actionsThisTurn = 0;
    const maxActionsPerTurn = 20;
    while (state.phase === 'move-cast' || state.phase === 'discard-draw') {
      if (actionsThisTurn++ > maxActionsPerTurn) break;
      if (state.winner !== null) break;

      const legal = getLegalActions(state, p.id);
      if (legal.length === 0) break;

      const action = await bot.chooseAction(state, legal);
      applyAction(state, action);

      // If the action ended the turn, break.
      if (action.type === 'end-turn') break;
    }

    // Ensure the turn ends.
    if (state.phase !== 'time-passes' && state.winner === null) {
      endTurn(state);
    }
  }

  return {
    winner: state.winner,
    turns,
    log: state.log.map((l) => l.text),
    finalState: state,
  };
}

// CLI entry point.
async function main() {
  const seed = parseInt(process.argv[2] ?? '42', 10);
  console.log(`Running simulation with seed ${seed}...`);
  const result = await runSimulation({
    seed,
    playerColors: ['blue', 'red', 'yellow', 'green'],
    botTypes: ['heuristic', 'heuristic', 'heuristic', 'heuristic'],
  });
  console.log(`Winner: ${result.winner === null ? 'None (max turns)' : result.finalState.players[result.winner].color}`);
  console.log(`Turns: ${result.turns}`);
  console.log(`Log entries: ${result.log.length}`);
  if (result.log.length > 0) {
    console.log('Last 10 log entries:');
    for (const entry of result.log.slice(-10)) {
      console.log(`  ${entry}`);
    }
  }
}

if (process.argv[1] && process.argv[1].includes('sim.ts')) {
  main().catch((err) => {
    console.error('Simulation failed:', err);
    process.exit(1);
  });
}