// LOS utilities with passive support.

import type { GameState, CellRef } from './types';
import { hasLOS, toGlobal, inBounds, toLocal, wallBetween, doorBetween, isDoorOpenFor, OPPOSITE } from './board';
import { hasVisionstone } from './passives';

// Check if a player can see a target, considering Visionstone passive.
export function canSee(
  state: GameState,
  playerId: number,
  from: CellRef,
  to: CellRef,
): boolean {
  // First check normal LOS.
  if (hasLOS(state.board, from, to, state.players.find(p => p.id === playerId)?.color)) {
    return true;
  }
  
  // Check if player has Visionstone (can see through 1 wall/door).
  if (hasVisionstone(state, playerId)) {
    // Check if the path is blocked by exactly 1 wall/door.
    return isBlockedByOneWall(state.board, from, to, state.players.find(p => p.id === playerId)?.color);
  }
  
  // Check if player has Around the Corner buff (can cast around corners).
  if (hasAroundTheCorner(state, playerId)) {
    // Around the Corner: if in same sector, always visible.
    if (from.sector === to.sector) return true;
  }
  
  return false;
}

// Check if the path from `from` to `to` is blocked by exactly 1 wall/door.
function isBlockedByOneWall(
  board: GameState['board'],
  from: CellRef,
  to: CellRef,
  observerColor?: string,
): boolean {
  const g1 = toGlobal(from);
  const g2 = toGlobal(to);
  const dr = g2.row - g1.row;
  const dc = g2.col - g1.col;
  
  const steps = Math.max(Math.abs(dr), Math.abs(dc));
  if (steps === 0) return false;
  const xStep = dc / steps;
  const yStep = dr / steps;
  
  let wallCount = 0;
  let x = g1.row;
  let y = g1.col;
  
  for (let i = 0; i < steps; i++) {
    const nx = Math.round((i + 1) * yStep + g1.col);
    const ny = Math.round((i + 1) * xStep + g1.row);
    
    // Check wall/door between (x,y) and (nx,ny).
    if (wallBlocksPath(board, x, y, nx, ny, observerColor)) {
      wallCount++;
      if (wallCount > 1) return false; // More than 1 wall blocks
    }
    x = nx;
    y = ny;
  }
  
  return wallCount === 1; // Exactly 1 wall blocks
}

// Check if a wall/door blocks the path between two cells.
function wallBlocksPath(
  board: GameState['board'],
  r1: number,
  c1: number,
  r2: number,
  c2: number,
  observerColor?: string,
): boolean {
  const dr = r2 - r1;
  const dc = c2 - c1;
  if (dr === 0 && dc === 0) return false;
  
  // Bounds check.
  if (!inBounds(r1, c1) || !inBounds(r2, c2)) return false;
  
  // Diagonal movement.
  if (dr !== 0 && dc !== 0) {
    const ref1 = toLocal(r1, c1);
    const dirR = dr === 1 ? 'S' : 'N';
    const dirC = dc === 1 ? 'E' : 'W';
    const wallR = wallBetween(board, ref1, dirR);
    const wallC = wallBetween(board, ref1, dirC);
    if (wallR && wallC) return true;
    return false;
  }
  
  // Determine direction.
  let dir: 'N' | 'S' | 'E' | 'W';
  if (dr === -1) dir = 'N';
  else if (dr === 1) dir = 'S';
  else if (dc === 1) dir = 'E';
  else dir = 'W';
  
  const ref1 = toLocal(r1, c1);
  const ref2 = toLocal(r2, c2);
  
  // Check wall.
  if (wallBetween(board, ref1, dir) || wallBetween(board, ref2, OPPOSITE[dir])) {
    return true;
  }
  
  // Check door.
  const door1 = doorBetween(board, ref1, dir);
  const door2 = doorBetween(board, ref2, OPPOSITE[dir]);
  const door = door1 ?? door2;
  if (door && !door.destroyed) {
    const isOpen = observerColor !== undefined ? isDoorOpenFor(door, observerColor as any) : false;
    if (!isOpen) return true;
  }
  
  return false;
}

// Check if a player has the Around the Corner buff.
export function hasAroundTheCorner(state: GameState, playerId: number): boolean {
  const p = state.players.find((pl) => pl.id === playerId);
  if (!p) return false;
  
  return p.maintainedSpells.some(
    (spell) => spell.meta?.type === 'around-the-corner'
  );
}