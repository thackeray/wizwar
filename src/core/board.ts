// Board model: 4 sectors in a 2x2 arrangement, each 5x5. Global board 10x10.
// Topology is data-driven so M8 can swap in extracted data.

import type {
  BoardState,
  Cell,
  CellRef,
  Color,
  Dir,
  Door,
  EdgePos,
  PortalDef,
  SectorState,
  WallToken,
} from './types';
import { DIR_DELTA, OPPOSITE, COLORS, DIRS } from './types';

export const SECTOR_SIZE = 5;
export const BOARD_SIZE = 10;

// Fixed 2x2 arrangement of sectors in the global board.
export const SECTOR_ORIGIN: Record<Color, { row: number; col: number }> = {
  blue: { row: 0, col: 0 },
  red: { row: 0, col: 5 },
  yellow: { row: 5, col: 0 },
  green: { row: 5, col: 5 },
};

export function sectorAt(row: number, col: number): Color {
  if (row < 5 && col < 5) return 'blue';
  if (row < 5 && col >= 5) return 'red';
  if (row >= 5 && col < 5) return 'yellow';
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

  const side: 'front' | 'back' = Math.random() < 0.5 ? 'front' : 'back';
  return { color, rotation: 0, grid, side };
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

// --- Data-driven topology (from extract-board.py / board-data.json) ---

export interface TopologyCell {
  kind?: 'corridor' | 'home' | 'treasure-start';
  walls?: Partial<Record<Dir, boolean>>;
  doors?: Partial<Record<Dir, { color: Color; locked?: boolean }>>;
}

export interface BoardTopology {
  sectors: Partial<Record<Color, TopologyCell[][]>>;
  portals?: PortalDef[];
}

// Build a BoardState from extracted topology data. Missing sectors fall back
// to the placeholder layout so partial data still works.
export function createBoardFromTopology(topo: BoardTopology): BoardState {
  const board = createBoard();
  for (const color of COLORS) {
    const grid = topo.sectors[color];
    if (!grid) continue;
    const sector = board.sectors[color];
    for (let r = 0; r < SECTOR_SIZE; r++) {
      for (let c = 0; c < SECTOR_SIZE; c++) {
        const tc = grid[r]?.[c];
        if (!tc) continue;
        const cell = sector.grid[r][c];
        if (tc.kind) cell.kind = tc.kind;
        if (tc.walls) {
          for (const d of DIRS) {
            if (tc.walls[d] !== undefined) cell.walls[d] = tc.walls[d]!;
          }
        }
        if (tc.doors) {
          for (const d of DIRS) {
            const door = tc.doors[d];
            if (door) {
              cell.doors[d] = {
                color: door.color,
                locked: door.locked ?? true,
                cracks: 0,
                destroyed: false,
                heldOpenBy: null,
                sealed: false,
              };
            }
          }
        }
      }
    }
  }
  if (topo.portals) board.portals = topo.portals;
  return board;
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

// §17.2.1: Get the effective direction after accounting for sector rotation.
function getEffectiveDir(sector: SectorState, dir: Dir): Dir {
  const rotation = sector.rotation;
  if (rotation === 0) return dir;
  
  // Rotate direction counter-clockwise by rotation * 90°.
  const dirs: Dir[] = ['N', 'E', 'S', 'W'];
  const idx = dirs.indexOf(dir);
  const rotatedIdx = (idx - rotation + 4) % 4;
  return dirs[rotatedIdx];
}

// Is there a wall (static or dynamic) blocking movement from `from` in `dir`?
export function wallBetween(
  board: BoardState,
  from: CellRef,
  dir: Dir,
): boolean {
  const cell = getCell(board, from);
  const sector = board.sectors[from.sector];
  const effectiveDir = getEffectiveDir(sector, dir);
  if (cell.walls[effectiveDir]) return true;
  const dw = cell.dynamicWalls[effectiveDir];
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
  const sector = board.sectors[from.sector];
  const effectiveDir = getEffectiveDir(sector, dir);
  return cell.doors[effectiveDir];
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
    // Check door first - doors can override walls.
    const door = doorBetween(board, from, dir);
    if (door && !door.destroyed) {
      // Door must be open for this color or held open.
      if (door.locked && door.color !== color && door.heldOpenBy === null) {
        return null;
      }
      return { sector: from.sector, r: nr, c: nc };
    }
    // No door - check wall.
    if (wallBetween(board, from, dir)) return null;
    return { sector: from.sector, r: nr, c: nc };
  }

  // Off the edge of this sector -> check for portal or block.
  // Determine global position.
  const g = toGlobal(from);
  const gr = g.row + d.dr;
  const gc = g.col + d.dc;

  // Portal check: is there a portal on this edge at this index?
  const portal = findPortalAtEdge(board, from.sector, dir, from.r, from.c);
  if (portal) {
    const dest = portalOtherEnd(portal, from.sector, dir);
    if (dest) return dest;
  }

  // Check if we're still on the board.
  if (gr < 0 || gr >= BOARD_SIZE || gc < 0 || gc >= BOARD_SIZE) {
    return null; // Blocked by board edge
  }

  const dest = toLocal(gr, gc);

  // Check boundary wall (stored on either side of the boundary).
  if (wallBetween(board, from, dir) || wallBetween(board, dest, OPPOSITE[dir])) {
    return null;
  }

  // Check boundary door (stored on either side of the boundary).
  const door1 = doorBetween(board, from, dir);
  const door2 = doorBetween(board, dest, OPPOSITE[dir]);
  const door = door1 ?? door2;
  if (door && !door.destroyed) {
    if (door.locked && door.color !== color && door.heldOpenBy === null) {
      return null;
    }
  }

  return dest;
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
// Blocked by walls (including columns) and closed doors.
// Can pass through objects/wizards/treasures.
// Portal-connected cells are always visible to each other.
// Around the Corner: allows seeing around corners (relaxed LOS).
export function hasLOS(
  board: BoardState,
  from: CellRef,
  to: CellRef,
  observerColor?: Color,
  aroundTheCorner = false,
): boolean {
  if (from.sector === to.sector && from.r === to.r && from.c === to.c) return true;

  // Check if connected by portal (always visible).
  if (isConnectedByPortal(board, from, to)) return true;

  // Around the Corner: if in same sector, always visible.
  if (aroundTheCorner && from.sector === to.sector) return true;

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
    // Check wall/door between (x,y) and (nx,ny).
    if (wallBlocksLOS(board, x, y, nx, ny, observerColor)) return false;
    x = nx;
    y = ny;
  }
  return true;
}

// Check if two cells are connected by a portal.
export function isConnectedByPortal(board: BoardState, a: CellRef, b: CellRef): boolean {
  for (const portal of board.portals) {
    const posA = portalEdgeToCell(portal.a);
    const posB = portalEdgeToCell(portal.b);
    // Check if a is at one end and b is at the other (or vice versa).
    if (
      (posA.sector === a.sector && posA.r === a.r && posA.c === a.c &&
       posB.sector === b.sector && posB.r === b.r && posB.c === b.c) ||
      (posA.sector === b.sector && posA.r === b.r && posA.c === b.c &&
       posB.sector === a.sector && posB.r === a.r && posB.c === a.c)
    ) {
      return true;
    }
  }
  return false;
}

// Convert a portal edge position to a cell reference.
function portalEdgeToCell(ep: EdgePos): CellRef {
  let r = 0, c = 0;
  if (ep.edge === 'N') { r = 0; c = ep.index; }
  else if (ep.edge === 'S') { r = SECTOR_SIZE - 1; c = ep.index; }
  else if (ep.edge === 'E') { r = ep.index; c = SECTOR_SIZE - 1; }
  else { r = ep.index; c = 0; }
  return { sector: ep.sector, r, c };
}

function wallBlocksLOS(
  board: BoardState,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
  observerColor?: Color,
): boolean {
  const dr = r2 - r1;
  const dc = c2 - c1;
  if (dr === 0 && dc === 0) return false;

  // Bounds check: if either cell is out of bounds, no wall blocks.
  if (!inBounds(r1, c1) || !inBounds(r2, c2)) return false;

  // Diagonal movement: check if both walls forming the corner are present.
  if (dr !== 0 && dc !== 0) {
    const ref1 = toLocal(r1, c1);
    // Determine the two directions that form the corner.
    const dirR: Dir = dr === 1 ? 'S' : 'N';
    const dirC: Dir = dc === 1 ? 'E' : 'W';
    
    // Check if both walls are present (either on ref1 or the adjacent cells).
    const wallR = wallBetween(board, ref1, dirR);
    const wallC = wallBetween(board, ref1, dirC);
    
    // If both walls are present, the diagonal is blocked.
    if (wallR && wallC) return true;
    
    // Also check doors - if both are closed doors, blocked.
    const doorR = doorBetween(board, ref1, dirR);
    const doorC = doorBetween(board, ref1, dirC);
    const doorRBlocked = doorR && !doorR.destroyed && !isDoorOpenFor(doorR, observerColor ?? 'blue');
    const doorCBlocked = doorC && !doorC.destroyed && !isDoorOpenFor(doorC, observerColor ?? 'blue');
    if (doorRBlocked && doorCBlocked) return true;
    
    // Mixed wall+door also blocks.
    if ((wallR && doorCBlocked) || (wallC && doorRBlocked)) return true;
    
    return false;
  }

  // Determine direction from cell1 to cell2.
  let dir: Dir;
  if (dr === -1) dir = 'N';
  else if (dr === 1) dir = 'S';
  else if (dc === 1) dir = 'E';
  else dir = 'W';

  // Check wall on either side (walls can be stored on either cell).
  const ref1 = toLocal(r1, c1);
  const ref2 = toLocal(r2, c2);
  if (wallBetween(board, ref1, dir) || wallBetween(board, ref2, OPPOSITE[dir])) {
    return true;
  }

  // Check door on either side (doors can be stored on either cell).
  const door1 = doorBetween(board, ref1, dir);
  const door2 = doorBetween(board, ref2, OPPOSITE[dir]);
  const door = door1 ?? door2;
  if (door && !door.destroyed) {
    // A closed door blocks LOS.
    const isOpen = observerColor !== undefined ? isDoorOpenFor(door, observerColor) : false;
    if (!isOpen) {
      return true;
    }
  }

  return false;
}

// --- Doors ---

export function isDoorOpenFor(door: Door, color: Color): boolean {
  if (door.destroyed) return true;
  if (door.sealed) return false;
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
  return { color, locked, cracks: 0, destroyed: false, heldOpenBy: null, sealed: false };
}

export { OPPOSITE };