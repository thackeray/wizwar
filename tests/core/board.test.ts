import { describe, it, expect } from 'vitest';
import {
  createBoard,
  moveDestination,
  hasLOS,
  adjacentRefs,
  toGlobal,
  toLocal,
  sectorAt,
} from '../../src/core/board';
import type { CellRef } from '../../src/core/types';

describe('board topology', () => {
  it('maps global coords to sectors correctly', () => {
    expect(sectorAt(0, 0)).toBe('blue');
    expect(sectorAt(0, 15)).toBe('red');
    expect(sectorAt(15, 0)).toBe('yellow');
    expect(sectorAt(15, 15)).toBe('green');
  });

  it('converts between global and local coords', () => {
    const ref: CellRef = { sector: 'blue', r: 3, c: 4 };
    const g = toGlobal(ref);
    expect(g).toEqual({ row: 3, col: 4 });
    expect(toLocal(3, 4)).toEqual(ref);

    const ref2: CellRef = { sector: 'green', r: 2, c: 5 };
    const g2 = toGlobal(ref2);
    expect(g2).toEqual({ row: 10, col: 13 });
    expect(toLocal(10, 13)).toEqual(ref2);
  });

  it('creates a board with 4 sectors', () => {
    const board = createBoard();
    expect(Object.keys(board.sectors)).toHaveLength(4);
    for (const color of ['blue', 'red', 'yellow', 'green']) {
      expect(board.sectors[color as keyof typeof board.sectors].grid).toHaveLength(8);
      expect(board.sectors[color as keyof typeof board.sectors].grid[0]).toHaveLength(8);
    }
  });

  it('places home bases in outer corners', () => {
    const board = createBoard();
    // Blue home base should be in top-left corner area.
    expect(board.sectors.blue.grid[0][0].kind).toBe('home');
    // Green home base should be in bottom-right corner area.
    expect(board.sectors.green.grid[7][7].kind).toBe('home');
  });

  it('places treasure start squares', () => {
    const board = createBoard();
    let treasureCount = 0;
    for (const color of ['blue', 'red', 'yellow', 'green']) {
      const sector = board.sectors[color as keyof typeof board.sectors];
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          if (sector.grid[r][c].kind === 'treasure-start') treasureCount++;
        }
      }
    }
    expect(treasureCount).toBe(8); // 2 per sector
  });
});

describe('movement', () => {
  it('moves within a sector', () => {
    const board = createBoard();
    const from: CellRef = { sector: 'blue', r: 3, c: 3 };
    const dest = moveDestination(board, from, 'S', 'blue');
    expect(dest).toEqual({ sector: 'blue', r: 4, c: 3 });
  });

  it('wraps around at board edges', () => {
    const board = createBoard();
    // Moving north from the top edge wraps to the bottom of the board.
    const from: CellRef = { sector: 'blue', r: 0, c: 3 };
    const dest = moveDestination(board, from, 'N', 'blue');
    // Bottom of board at col 3 is in the yellow sector (bottom-left).
    expect(dest).toEqual({ sector: 'yellow', r: 7, c: 3 });
  });

  it('returns null for blocked moves', () => {
    const board = createBoard();
    // Add a wall to block movement.
    board.sectors.blue.grid[3][3].walls.S = true;
    const from: CellRef = { sector: 'blue', r: 3, c: 3 };
    const dest = moveDestination(board, from, 'S', 'blue');
    expect(dest).toBeNull();
  });
});

describe('line of sight', () => {
  it('has LOS in open space', () => {
    const board = createBoard();
    const from: CellRef = { sector: 'blue', r: 3, c: 3 };
    const to: CellRef = { sector: 'blue', r: 3, c: 5 };
    expect(hasLOS(board, from, to)).toBe(true);
  });

  it('blocks LOS with walls', () => {
    const board = createBoard();
    // Add a wall between the two cells.
    board.sectors.blue.grid[3][4].walls.W = true;
    const from: CellRef = { sector: 'blue', r: 3, c: 3 };
    const to: CellRef = { sector: 'blue', r: 3, c: 5 };
    expect(hasLOS(board, from, to)).toBe(false);
  });
});

describe('adjacency', () => {
  it('finds adjacent cells', () => {
    const from: CellRef = { sector: 'blue', r: 3, c: 3 };
    const adj = adjacentRefs(from);
    expect(adj).toHaveLength(4);
    expect(adj).toContainEqual({ sector: 'blue', r: 2, c: 3 });
    expect(adj).toContainEqual({ sector: 'blue', r: 4, c: 3 });
    expect(adj).toContainEqual({ sector: 'blue', r: 3, c: 2 });
    expect(adj).toContainEqual({ sector: 'blue', r: 3, c: 4 });
  });

  it('handles edge cells', () => {
    const from: CellRef = { sector: 'blue', r: 0, c: 0 };
    const adj = adjacentRefs(from);
    expect(adj).toHaveLength(2); // Only S and E are valid.
  });
});