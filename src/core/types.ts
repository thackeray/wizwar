// Wiz-War core type definitions. Pure logic, zero UI dependency.

import type { RNG } from './rng';

export type Color = 'blue' | 'red' | 'yellow' | 'green';
export const COLORS: Color[] = ['blue', 'red', 'yellow', 'green'];

export type Dir = 'N' | 'S' | 'E' | 'W';
export const DIRS: Dir[] = ['N', 'S', 'E', 'W'];

export const DIR_DELTA: Record<Dir, { dr: number; dc: number }> = {
  N: { dr: -1, dc: 0 },
  S: { dr: 1, dc: 0 },
  E: { dr: 0, dc: 1 },
  W: { dr: 0, dc: -1 },
};

export const OPPOSITE: Record<Dir, Dir> = {
  N: 'S',
  S: 'N',
  E: 'W',
  W: 'E',
};

// A cell reference within a single sector's 8x8 grid.
export interface CellRef {
  sector: Color;
  r: number; // 0..7
  c: number; // 0..7
}

export type School =
  | 'cantrip'
  | 'alchemy'
  | 'conjuring'
  | 'elemental'
  | 'mentalism'
  | 'mutation'
  | 'thaumaturgy';

export const SCHOOLS: School[] = [
  'cantrip',
  'alchemy',
  'conjuring',
  'elemental',
  'mentalism',
  'mutation',
  'thaumaturgy',
];

export type CardType =
  | 'attack-spell'
  | 'counter-spell'
  | 'neutral-spell'
  | 'item'
  | 'energy'
  | 'transform';

export type RangeKind =
  | 'caster'
  | 'adjacent'
  | 'los'
  | 'anywhere'
  | 'same-sector';

export type DurationKind = 'instant' | 'temporary' | 'permanent';

export type TargetKind =
  | 'wizard'
  | 'creature'
  | 'object'
  | 'square'
  | 'wall'
  | 'door'
  | 'self'
  | 'game-board'
  | 'spell'
  | 'line'
  | 'treasure';

export type DamageKind = 'magical' | 'physical';

// A machine-readable effect node. The resolver walks this tree.
export interface EffectNode {
  op: string;
  [key: string]: unknown;
}

export interface CardDef {
  id: string;
  name: string;
  school: School;
  type: CardType;
  energy: number; // base energy (temporary spell duration)
  range: RangeKind;
  duration: DurationKind;
  target: TargetKind;
  energyValue: number; // blue circle: usable as energy card (0 = no)
  text: string; // display text
  effect: EffectNode;
  // Optional flags
  countsAsAttack?: boolean;
  cannotEvade?: boolean;
  // Item-specific
  mobile?: boolean; // mobile objects can be picked up
  crackLimit?: number; // how many cracks before destroyed
  // Transform-specific
  baseSpeed?: number;
}

// A target reference for actions/effects.
export type TargetRef =
  | { kind: 'wizard'; id: number }
  | { kind: 'cell'; ref: CellRef }
  | { kind: 'wall'; ref: WallRef }
  | { kind: 'door'; ref: DoorRef }
  | { kind: 'object'; id: number }
  | { kind: 'treasure'; id: number }
  | { kind: 'spell'; index: number }
  | { kind: 'self' };

export interface WallRef {
  sector: Color;
  r: number;
  c: number;
  side: Dir; // which side of the cell the wall is on
}

export interface DoorRef {
  sector: Color;
  r: number;
  c: number;
  side: Dir;
}

export interface MaintainedSpell {
  cardId: string;
  energy: number; // remaining energy tokens
  target: TargetRef | null;
  owner: number;
}

export interface PlayerState {
  id: number;
  color: Color;
  isBot: boolean;
  life: number;
  vp: number;
  pos: CellRef;
  hand: string[]; // card ids
  carriedItems: string[]; // card ids
  carriedTreasure: number | null; // treasure marker id
  maintainedSpells: MaintainedSpell[];
  mp: number;
  speedBoosted: boolean;
  attacked: boolean;
  stunned: boolean;
  stunTokens: number;
  alive: boolean;
  transformed: string | null; // transform card id
}

export interface Cell {
  kind: 'corridor' | 'home' | 'treasure-start';
  walls: { N: boolean; S: boolean; E: boolean; W: boolean };
  doors: { N?: Door; S?: Door; E?: Door; W?: Door };
  dynamicWalls: { N?: WallToken; S?: WallToken; E?: WallToken; W?: WallToken };
  objects: DroppedObject[];
  treasures: number[]; // treasure marker ids
}

export interface Door {
  color: Color;
  locked: boolean;
  cracks: number;
  destroyed: boolean;
  heldOpenBy: number | null;
  sealed: boolean; // sealed doors cannot be opened/unlocked (but can be destroyed)
}

export interface WallToken {
  cracks: number;
  destroyed: boolean;
  owner: number | null; // hat token owner
}

export interface DroppedObject {
  cardId: string;
  id: number;
  owner: number | null; // hat token
}

export interface PortalDef {
  color: 'purple' | 'cyan';
  // positions on the board edges (in global board coords)
  a: EdgePos;
  b: EdgePos;
}

export interface EdgePos {
  sector: Color;
  edge: Dir;
  index: number; // 0..7 along the edge
}

export interface SectorState {
  color: Color;
  rotation: number; // 0-3
  grid: Cell[][]; // [8][8]
}

export interface BoardState {
  sectors: Record<Color, SectorState>;
  portals: PortalDef[];
}

export type Phase = 'time-passes' | 'move-cast' | 'discard-draw';

export interface LogEntry {
  turn: number;
  playerId: number;
  text: string;
  data?: unknown;
}

export interface GameState {
  seed: number;
  rng: RNG;
  players: PlayerState[];
  board: BoardState;
  deck: string[];
  discard: string[];
  currentPlayer: number;
  turnNumber: number; // global turn (1 = first, no attacks)
  phase: Phase;
  winner: number | null;
  log: LogEntry[];
  // runtime helpers
  nextObjectId: number;
  nextTreasureId: number;
  // counter-spell sub-state
  awaitingCounter: CastInfo | null;
}

export interface CastInfo {
  caster: number;
  cardId: string;
  target: TargetRef | null;
  energyCard: string | null;
}

export type Action =
  | { type: 'move'; dir: Dir }
  | { type: 'punch'; target: number }
  | { type: 'cast'; cardId: string; target?: TargetRef; energyCard?: string }
  | { type: 'use-item'; cardId: string; target?: TargetRef }
  | { type: 'pick-up-object'; objectId: number }
  | { type: 'drop-item'; cardId: string }
  | { type: 'pick-up-treasure'; treasureId: number }
  | { type: 'drop-treasure' }
  | { type: 'end-spell'; index: number }
  | { type: 'discard'; cardIds: string[] }
  | { type: 'draw'; count: number }
  | { type: 'boost-speed'; cardId: string }
  | { type: 'counter'; cardId: string; spellIndex: number }
  | { type: 'end-turn' };

export interface Result {
  ok: boolean;
  reason?: string;
  events: GameEvent[];
}

export type GameEvent =
  | { type: 'log'; text: string }
  | { type: 'move'; playerId: number; from: CellRef; to: CellRef }
  | { type: 'damage'; target: number; amount: number; kind: DamageKind }
  | { type: 'death'; playerId: number; killer: number | null }
  | { type: 'vp'; playerId: number; amount: number }
  | { type: 'cast'; playerId: number; cardId: string }
  | { type: 'draw'; playerId: number; count: number }
  | { type: 'discard'; playerId: number; cardIds: string[] }
  | { type: 'phase'; phase: Phase }
  | { type: 'turn-start'; playerId: number }
  | { type: 'turn-end'; playerId: number }
  | { type: 'game-over'; winner: number };