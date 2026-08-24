// E2E tests for AI battle.

import { describe, it, expect } from 'vitest';
import { createBoard } from '../../src/core/board';
import { createGameState } from '../../src/core/state';
import { buildDeck } from '../../src/core/cards/registry';
import { loadBuiltInCards } from '../../src/core/cards';
import { HeuristicBot, RandomBot } from '../../src/core/ai/bots';
import { runBattle } from '../../src/headless/run-game';
import type { GameState } from '../../src/core/types';

function makeGame(seed = 42): GameState {
  loadBuiltInCards();
  const board = createBoard();
  const deck = buildDeck(['cantrip', 'alchemy', 'elemental']);
  return createGameState(
    {
      seed,
      playerColors: ['blue', 'red'],
      botSeats: [true, true],
      schools: ['cantrip', 'alchemy', 'elemental'],
      cantripSchool: 'cantrip',
    },
    board,
    deck,
  );
}

describe('M6: AI Battle E2E', () => {
  it('should run a 2-player AI battle to completion', async () => {
    const state = makeGame(42);
    const bots = [new HeuristicBot(), new HeuristicBot()];
    
    const result = await runBattle(state, bots, {
      seed: 42,
      playerColors: ['blue', 'red'],
      botTypes: ['heuristic', 'heuristic'],
      schools: ['cantrip', 'alchemy', 'elemental'],
      maxTurns: 100,
    });
    
    // Should have a winner or reach max turns.
    expect(result.turns).toBeGreaterThan(0);
    expect(result.winner !== null || result.turns >= 100).toBe(true);
  });

  it('should run a 2-player random AI battle', async () => {
    const state = makeGame(123);
    const bots = [new RandomBot(), new RandomBot()];
    
    const result = await runBattle(state, bots, {
      seed: 123,
      playerColors: ['blue', 'red'],
      botTypes: ['random', 'random'],
      schools: ['cantrip', 'alchemy', 'elemental'],
      maxTurns: 50,
    });
    
    // Should complete without errors.
    expect(result.turns).toBeGreaterThan(0);
  });

  it('should handle mixed bot types', async () => {
    const state = makeGame(456);
    const bots = [new HeuristicBot(), new RandomBot()];
    
    const result = await runBattle(state, bots, {
      seed: 456,
      playerColors: ['blue', 'red'],
      botTypes: ['heuristic', 'random'],
      schools: ['cantrip', 'alchemy', 'elemental'],
      maxTurns: 50,
    });
    
    // Should complete without errors.
    expect(result.turns).toBeGreaterThan(0);
  });
});