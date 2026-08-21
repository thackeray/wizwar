// GameState construction and helpers.

import type {
  BoardState,
  CellRef,
  Color,
  GameState,
  PlayerState,
  School,
} from './types';
import { SECTOR_ORIGIN } from './board';
import { mulberry32 } from './rng';

export interface NewGameConfig {
  seed: number;
  playerColors: Color[]; // 2-4 colors
  botSeats: boolean[]; // which seats are bots
  schools: School[]; // 3 chosen schools (plus cantrip)
  cantripSchool: School; // usually 'cantrip'
}

export function homeRef(color: Color): CellRef {
  const o = SECTOR_ORIGIN[color];
  const hr = o.row === 0 ? 0 : 6;
  const hc = o.col === 0 ? 0 : 6;
  return { sector: color, r: hr, c: hc };
}

export function createPlayer(
  id: number,
  color: Color,
  isBot: boolean,
): PlayerState {
  return {
    id,
    color,
    isBot,
    life: 15,
    vp: 0,
    pos: homeRef(color),
    hand: [],
    carriedItems: [],
    carriedTreasure: null,
    maintainedSpells: [],
    mp: 3,
    speedBoosted: false,
    attacked: false,
    stunned: false,
    stunTokens: 0,
    alive: true,
    transformed: null,
  };
}

export function createGameState(
  config: NewGameConfig,
  board: BoardState,
  deck: string[],
): GameState {
  const rng = mulberry32(config.seed);
  const players = config.playerColors.map((color, i) =>
    createPlayer(i, color, config.botSeats[i]),
  );

  // Place treasure markers on treasure-start squares.
  let nextTreasureId = 0;
  for (const p of players) {
    const sector = board.sectors[p.color];
    let placed = 0;
    for (let r = 0; r < 8 && placed < 2; r++) {
      for (let c = 0; c < 8 && placed < 2; c++) {
        if (sector.grid[r][c].kind === 'treasure-start') {
          sector.grid[r][c].treasures.push(nextTreasureId);
          nextTreasureId++;
          placed++;
        }
      }
    }
  }

  // Deal starting hands of 5.
  const shuffledDeck = rng.shuffle(deck);
  for (const p of players) {
    for (let i = 0; i < 5; i++) {
      p.hand.push(shuffledDeck.pop()!);
    }
  }

  return {
    seed: config.seed,
    rng,
    players,
    board,
    deck: shuffledDeck,
    discard: [],
    currentPlayer: 0,
    turnNumber: 1,
    phase: 'time-passes',
    winner: null,
    log: [],
    nextObjectId: 0,
    nextTreasureId,
    awaitingCounter: null,
  };
}

export function currentPlayer(state: GameState): PlayerState {
  return state.players[state.currentPlayer];
}

export function playerById(state: GameState, id: number): PlayerState {
  return state.players.find((p) => p.id === id)!;
}

export function alivePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => p.alive);
}

// Hand size includes carried items and maintained spells.
export function handSize(p: PlayerState): number {
  return p.hand.length + p.carriedItems.length + p.maintainedSpells.length;
}

export const MAX_HAND_SIZE = 7;
export const MAX_LIFE = 20;
export const START_LIFE = 15;

export function addLog(
  state: GameState,
  playerId: number,
  text: string,
  data?: unknown,
): void {
  state.log.push({ turn: state.turnNumber, playerId, text, data });
}

export function serialize(state: GameState): string {
  // RNG state is not serialized; replay uses seed + action log.
  const { seed, players, board, deck, discard, currentPlayer, turnNumber, phase, winner, log, nextObjectId, nextTreasureId, awaitingCounter } = state;
  return JSON.stringify({ seed, players, board, deck, discard, currentPlayer, turnNumber, phase, winner, log, nextObjectId, nextTreasureId, awaitingCounter });
}

export function deserialize(json: string): GameState {
  const data = JSON.parse(json);
  return { ...data, rng: mulberry32(data.seed) } as GameState;
}