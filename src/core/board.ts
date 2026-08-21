// Board model: 4 sectors in a 2x2 arrangement, each 8x8. Global board 16x16.
// Topology is data-driven so M8 can swap in extracted data.

import type {
  BoardState,
  Cell,
  CellRef,
  Color,
  Dir,
  Door,
  PortalDef,
  SectorState,
  WallToken,
} from './types';
import { DIR_DELTA, OPPOSITE } from './types';

export const SECTOR_SIZE = 8;
export const BOARD_SIZE = 16;

// Fixed 2x2 arrangement of sectors in the global board.
export const SECTOR_ORIGIN: Record<Color, { row: number; col: number }> = {
  blue: { row: 0, col: 0 },
  red: { row: 0, col: 8 },
  yellow: { row: 8, col: 0 },
  green: { row: 8, col: 8 },
};

export function sectorAt(row: number, col: number): Color {
  if (row < 8 && col < 8) return 'blue';
  if (row < 8 && col >= 8) return 'red';
  if (row >= 8 && col < 8) return 'yellow';
  return 'green';
}

export function toGlobal(ref: CellRef): { row: number; col: number } {
  const o = SECTOR_ORIGIN[ref.sector];
  return { row: o.row + ref.r, col: o.col + ref.c };
}

export function toLocal(row: number, col: number): CellRef {
  const sector = sectorAt(row, col);
  const o = SECTOR_ORIGIN[sector];
  return { sector, r: row - o.row, c: col - o.col };
}

export function inBounds(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function emptyCell(kind: Cell['kind'] = 'corridor'): Cell {
  return {
    kind,
    walls: { N: false, S: false, E: false, W: false },
    doors: {},
    dynamicWalls: {},
    objects: [],
    treasures: [],
  };
}

// Placeholder topology: each sector has a home base in its outer corner and
// 2 treasure-start squares. Real topology is extracted in M8.
export function createSector(color: Color): SectorState {
  const grid: Cell[][] = [];
  for (let r = 0; r < SECTOR_SIZE; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < SECTOR_SIZE; c++) {
      row.push(emptyCell());
    }
    grid.push(row);
  }

  // Determine the outer corner for this sector's home base.
  const o = SECTOR_ORIGIN[color];
  const homeR = o.row === 0 ? 0 : SECTOR_SIZE - 1;
  const homeC = o.col === 0 ? 0 : SECTOR_SIZE - 1;
  // Home base is a 2x2 area in the outer corner.
  const hr = homeR === 0 ? 0 : SECTOR_SIZE - 2;
  const hc = homeC === 0 ? 0 : SECTOR_SIZE - 2;
  for (let r = hr; r < hr + 2; r++) {
    for (let c = hc; c < hc + 2; c++) {
      grid[r][c].kind = 'home';
    }
  }
  // Treasure start squares: adjacent to home base, toward center.
  const tr = homeR === 0 ? 2 : SECTOR_SIZE - 3;
  const tc = homeC === 0 ? 2 : SECTOR_SIZE - 3;
  grid[tr][tc].kind = 'treasure-start';
  grid[tr + (homeR === 0 ? 1 : -1)][tc].kind = 'treasure-start';

  return { color, rotation: 0, grid };
}

export function createBoard(): BoardState {
  return {
    sectors: {
      blue: createSector('blue'),
      red: createSector('red'),
      yellow: createSector('yellow'),
      green: createSector('green'),
    },
    portals: [],
  };
}

export function getCell(board: BoardState, ref: CellRef): Cell {
  return board.sectors[ref.sector].grid[ref.r][ref.c];
}

export function getCellGlobal(board: BoardState, row: number, col: number): Cell {
  const ref = toLocal(row, col);
  return getCell(board, ref);
}

// --- Movement & adjacency ---

export function adjacentRefs(ref: CellRef): CellRef[] {
  const out: CellRef[] = [];
  for (const dir of ['N', 'S', 'E', 'W'] as Dir[]) {
    const d = DIR_DELTA[dir];
    const nr = ref.r + d.dr;
    const nc = ref.c + d.dc;
    if (nr < 0 || nr >= SECTOR_SIZE || nc < 0 || nc >= SECTOR_SIZE) continue;
    out.push({ sector: ref.sector, r: nr, c: nc });
  }
  return out;
}

// Is there a wall (static or dynamic) blocking movement from `from` in `dir`?
export function wallBetween(
  board: BoardState,
  from: CellRef,
  dir: Dir,
): boolean {
  const cell = getCell(board, from);
  if (cell.walls[dir]) return true;
  const dw = cell.dynamicWalls[dir];
  if (dw && !dw.destroyed) return true;
  return false;
}

// Is there a door between `from` and `from+dir`?
export function doorBetween(
  board: BoardState,
  from: CellRef,
  dir: Dir,
): Door | undefined {
  const cell = getCell(board, from);
  return cell.doors[dir];
}

// Can a wizard of `color` move from `from` in `dir`?
// Returns the destination CellRef, or null if blocked.
// Handles wraparound (off open edge) and portals.
export function moveDestination(
  board: BoardState,
  from: CellRef,
  dir: Dir,
  color: Color,
): CellRef | null {
  const d = DIR_DELTA[dir];
  const nr = from.r + d.dr;
  const nc = from.c + d.dc;

  // Within the same sector?
  if (nr >= 0 && nr < SECTOR_SIZE && nc >= 0 && nc < SECTOR_SIZE) {
    // Check wall/door between.
    if (wallBetween(board, from, dir)) return null;
    const door = doorBetween(board, from, dir);
    if (door && !door.destroyed) {
      // Door must be open for this color or held open.
      if (door.locked && door.color !== color && door.heldOpenBy === null) {
        return null;
      }
    }
    return { sector: from.sector, r: nr, c: nc };
  }

  // Off the edge of this sector -> wraparound or portal.
  // Determine global position and where we'd re-enter.
  const g = toGlobal(from);
  let gr = g.row + d.dr;
  let gc = g.col + d.dc;

  // Portal check: is there a portal on this edge at this index?
  const portal = findPortalAtEdge(board, from.sector, dir, from.r, from.c);
  if (portal) {
    const dest = portalOtherEnd(portal, from.sector, dir);
    if (dest) return dest;
  }

  // Wraparound: re-enter on the opposite side of the board.
  if (gr < 0) gr = BOARD_SIZE - 1;
  else if (gr >= BOARD_SIZE) gr = 0;
  if (gc < 0) gc = BOARD_SIZE - 1;
  else if (gc >= BOARD_SIZE) gc = 0;

  return toLocal(gr, gc);
}

function findPortalAtEdge(
  board: BoardState,
  sector: Color,
  edge: Dir,
  r: number,
  c: number,
): PortalDef | null {
  for (const p of board.portals) {
    for (const ep of [p.a, p.b]) {
      if (ep.sector === sector && ep.edge === edge) {
        // index along the edge
        const idx = edge === 'N' || edge === 'S' ? c : r;
        if (ep.index === idx) return p;
      }
    }
  }
  return null;
}

function portalOtherEnd(
  portal: PortalDef,
  sector: Color,
  edge: Dir,
): CellRef | null {
  const other = portal.a.sector === sector && portal.a.edge === edge ? portal.b : portal.a;
  let r = 0, c = 0;
  if (other.edge === 'N') { r = 0; c = other.index; }
  else if (other.edge === 'S') { r = SECTOR_SIZE - 1; c = other.index; }
  else if (other.edge === 'E') { r = other.index; c = SECTOR_SIZE - 1; }
  else { r = other.index; c = 0; }
  return { sector: other.sector, r, c };
}

// --- Line of Sight ---

// Check LOS from `from` to `to`. Returns true if visible.
// Blocked by walls (including columns). Can pass through objects/wizards/treasures.
export function hasLOS(
  board: BoardState,
  from: CellRef,
  to: CellRef,
): boolean {
  if (from.sector === to.sector && from.r === to.r && from.c === to.c) return true;

  const g1 = toGlobal(from);
  const g2 = toGlobal(to);
  const dr = g2.row - g1.row;
  const dc = g2.col - g1.col;

  // Bresenham line walk.
  const steps = Math.max(Math.abs(dr), Math.abs(dc));
  if (steps === 0) return true;
  const xStep = dc / steps;
  const yStep = dr / steps;

  let x = g1.row;
  let y = g1.col;
  for (let i = 0; i < steps; i++) {
    const nx = Math.round((i + 1) * yStep + g1.col);
    const ny = Math.round((i + 1) * xStep + g1.row);
    // Check wall between (x,y) and (nx,ny).
    if (wallBlocksLOS(board, x, y, nx, ny)) return false;
    x = nx;
    y = ny;
  }
  return true;
}

function wallBlocksLOS(
  board: BoardState,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): boolean {
  const dr = r2 - r1;
  const dc = c2 - c1;
  if (dr === 0 && dc === 0) return false;
  // Determine direction from cell1 to cell2.
  let dir: Dir;
  if (dr === -1) dir = 'N';
  else if (dr === 1) dir = 'S';
  else if (dc === 1) dir = 'E';
  else if (dc === -1) dir = 'W';
  else return false; // diagonal, not a direct wall check

  // Bounds check: if either cell is out of bounds, no wall blocks.
  if (!inBounds(r1, c1) || !inBounds(r2, c2)) return false;

  // Check wall on either side (walls can be stored on either cell).
  const ref1 = toLocal(r1, c1);
  const ref2 = toLocal(r2, c2);
  return wallBetween(board, ref1, dir) || wallBetween(board, ref2, OPPOSITE[dir]);
}

// --- Doors ---

export function isDoorOpenFor(door: Door, color: Color): boolean {
  if (door.destroyed) return true;
  if (!door.locked) return true;
  if (door.color === color) return true;
  if (door.heldOpenBy !== null) return true;
  return false;
}

// --- Helpers for tests ---

export function makeTestBoard(): BoardState {
  return createBoard();
}

export function emptySector(color: Color): SectorState {
  return createSector(color);
}

export function makeWallToken(cracks = 0): WallToken {
  return { cracks, destroyed: false, owner: null };
}

export function makeDoor(color: Color, locked = true): Door {
  return { color, locked, cracks: 0, destroyed: false, heldOpenBy: null };
}

export { OPPOSITE };