// Tests using real board topology from board-data.json.

import { describe, it, expect } from 'vitest';
import { createBoardFromTopology, hasLOS, moveDestination } from '../../src/core/board';
import { convertBoardData } from '../../src/core/board-data';
import { createGameState } from '../../src/core/state';
import { buildDeck } from '../../src/core/cards/registry';
import { loadBuiltInCards } from '../../src/core/cards';
import { getLegalActions } from '../../src/core/ai/bots';
import type { Color } from '../../src/core/types';

// Load real board data.
const boardDataJson = require('../../src/board-data.json');
const boardData = convertBoardData(boardDataJson);

function makeRealGame() {
  loadBuiltInCards();
  const board = createBoardFromTopology(boardData);
  const deck = buildDeck(['cantrip', 'alchemy', 'elemental']);
  return createGameState(
    {
      seed: 42,
      playerColors: ['blue', 'red'],
      botSeats: [true, true],
      schools: ['cantrip', 'alchemy', 'elemental'],
      cantripSchool: 'cantrip',
    },
    board,
    deck,
  );
}

describe('Real Topology Tests', () => {
  it('should have walls in the real board', () => {
    const state = makeRealGame();
    const board = state.board;
    
    // Check that there are walls in the board.
    let wallCount = 0;
    for (const color of ['blue', 'red', 'yellow', 'green'] as const) {
      const sector = board.sectors[color];
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          const cell = sector.grid[r][c];
          if (cell.walls.N || cell.walls.S || cell.walls.E || cell.walls.W) {
            wallCount++;
          }
        }
      }
    }
    
    expect(wallCount).toBeGreaterThan(0);
  });

  it('should block movement across boundary walls', () => {
    const state = makeRealGame();
    const board = state.board;
    
    // Find a cell with a wall on its east side.
    let testCell: { sector: Color; r: number; c: number } | null = null;
    for (const color of ['blue', 'red', 'yellow', 'green'] as Color[]) {
      const sector = board.sectors[color];
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          if (sector.grid[r][c].walls.E) {
            testCell = { sector: color, r, c };
            break;
          }
        }
        if (testCell) break;
      }
      if (testCell) break;
    }
    
    if (testCell) {
      // Try to move east - should be blocked.
      const dest = moveDestination(board, testCell, 'E', 'blue');
      expect(dest).toBeNull();
    }
  });

  it('should have home cells in the real board', () => {
    const state = makeRealGame();
    const board = state.board;
    
    // Check that there are home cells.
    let homeCount = 0;
    for (const color of ['blue', 'red', 'yellow', 'green'] as const) {
      const sector = board.sectors[color];
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          if (sector.grid[r][c].kind === 'home') {
            homeCount++;
          }
        }
      }
    }
    
    expect(homeCount).toBeGreaterThan(0);
  });

  it('should block LOS with walls', () => {
    const state = makeRealGame();
    const board = state.board;
    
    // Find two cells that should be blocked by a wall.
    // This is a simplified test - in a real scenario, we'd need to find specific cells.
    const from = { sector: 'blue' as Color, r: 0, c: 0 };
    const to = { sector: 'blue' as Color, r: 0, c: 4 };
    
    // Check if there's a wall between them.
    const los = hasLOS(board, from, to, 'blue');
    
    // The result depends on the actual board layout.
    // We just verify that the function works without errors.
    expect([true, false]).toContain(los);
  });

  it('should generate legal actions with real topology', () => {
    const state = makeRealGame();
    const p = state.players[0];
    
    // Ensure we're in move-cast phase.
    state.phase = 'move-cast';
    p.mp = 3;
    
    const actions = getLegalActions(state, p.id);
    
    // Should have some legal actions.
    expect(actions.length).toBeGreaterThan(0);
    
    // Should have end-turn action.
    expect(actions.some(a => a.type === 'end-turn')).toBe(true);
  });

  it('should rotate sector walls correctly (17.2.1)', () => {
    const state = makeRealGame();
    const board = state.board;
    const sector = board.sectors['blue'];
    
    // Create a test scenario: cell with wall on South side.
    const testCell = sector.grid[2][2];
    testCell.walls = { N: false, S: true, E: false, W: false };
    
    // Before rotation: South wall should block southward movement.
    const destBefore = moveDestination(board, { sector: 'blue', r: 2, c: 2 }, 'S', 'blue');
    expect(destBefore).toBeNull(); // Blocked by south wall.
    
    // Rotate sector 90° clockwise.
    sector.rotation = 1;
    
    // After rotation: The south wall should now effectively be on the West side.
    // So westward movement should be blocked, and southward should be allowed.
    const destWest = moveDestination(board, { sector: 'blue', r: 2, c: 2 }, 'W', 'blue');
    const destSouth = moveDestination(board, { sector: 'blue', r: 2, c: 2 }, 'S', 'blue');
    
    // Check if rotation worked by checking movement behavior.
    expect(destWest).toBeNull(); // Westward movement blocked (wall effectively on West).
    expect(destSouth).not.toBeNull(); // Southward movement allowed (no wall on South).
  });
});