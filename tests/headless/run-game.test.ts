// Tests for runBattle convergence.

import { describe, it, expect } from 'vitest';
import { createBoardFromTopology } from '../../src/core/board';
import { convertBoardData } from '../../src/core/board-data';
import { createGameState } from '../../src/core/state';
import { loadBuiltInCards } from '../../src/core/cards';
import { buildDeck } from '../../src/core/cards/registry';
import { HeuristicBot } from '../../src/core/ai/bots';
import { runBattle } from '../../src/headless/run-game';
import type { GameState, School } from '../../src/core/types';
import boardDataJSON from '../../src/board-data.json';

function makeGame(seed: number): GameState {
  loadBuiltInCards();
  const topo = convertBoardData(boardDataJSON as any);
  const board = createBoardFromTopology(topo);
  const schools: School[] = ['cantrip', 'alchemy', 'elemental', 'mentalism'];
  const deck = buildDeck(schools);
  
  return createGameState(
    {
      seed,
      playerColors: ['blue', 'red'],
      botSeats: [true, true],
      schools,
      cantripSchool: 'cantrip',
    },
    board,
    deck,
  );
}

describe('runBattle convergence', () => {
  it('turnNumber increments with fixed seed', async () => {
    const state = makeGame(42);
    const bots = [new HeuristicBot(), new HeuristicBot()];
    
    const initialTurn = state.turnNumber;
    
    await runBattle(state, bots, {
      seed: 42,
      playerColors: ['blue', 'red'],
      botTypes: ['heuristic', 'heuristic'],
      schools: ['cantrip', 'alchemy', 'elemental', 'mentalism'],
      maxTurns: 10,
      delayMs: 0,
    });
    
    expect(state.turnNumber).toBeGreaterThan(initialTurn);
  });
  
  it('reaches discard-draw phase', async () => {
    const state = makeGame(42);
    const bots = [new HeuristicBot(), new HeuristicBot()];
    
    let reachedDiscardDraw = false;
    
    await runBattle(state, bots, {
      seed: 42,
      playerColors: ['blue', 'red'],
      botTypes: ['heuristic', 'heuristic'],
      schools: ['cantrip', 'alchemy', 'elemental', 'mentalism'],
      maxTurns: 10,
      delayMs: 0,
      callbacks: {
        afterAction: (s) => {
          if (s.phase === 'discard-draw') {
            reachedDiscardDraw = true;
          }
        },
      },
    });
    
    expect(reachedDiscardDraw).toBe(true);
  });
  
  it('multiple seeds end within 500 turns or turnNumber grows significantly', async () => {
    const seeds = [1, 2, 3, 4, 5];
    
    for (const seed of seeds) {
      const state = makeGame(seed);
      const bots = [new HeuristicBot(), new HeuristicBot()];
      
      const initialTurn = state.turnNumber;
      
      await runBattle(state, bots, {
        seed,
        playerColors: ['blue', 'red'],
        botTypes: ['heuristic', 'heuristic'],
        schools: ['cantrip', 'alchemy', 'elemental', 'mentalism'],
        maxTurns: 500,
        delayMs: 0,
      });
      
      // Either game ended or turnNumber grew significantly.
      const turnGrowth = state.turnNumber - initialTurn;
      expect(state.winner !== null || turnGrowth > 10).toBe(true);
    }
  });
});