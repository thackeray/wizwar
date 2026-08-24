// GameState construction and helpers.

import type {
  BoardState,
  CellRef,
  Color,
  GameState,
  PlayerState,
  School,
} from './types';
import { mulberry32 } from './rng';

export interface NewGameConfig {
  seed: number;
  playerColors: Color[]; // 2-4 colors
  botSeats: boolean[]; // which seats are bots
  schools: School[]; // 3 chosen schools (plus cantrip)
  cantripSchool: School; // usually 'cantrip'
}

export function homeRef(color: Color): CellRef {
  // All sectors have home at (2,2) per board-data.json
  return { sector: color, r: 2, c: 2 };
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
    attacksUsed: 0,
    stunned: false,
    stunTokens: 0,
    alive: true,
    transformed: null,
    stunnedActionUsed: null,
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
  const treasureHome: Record<number, Color> = {};
  for (const p of players) {
    const sector = board.sectors[p.color];
    let placed = 0;
    for (let r = 0; r < 5 && placed < 2; r++) {
      for (let c = 0; c < 5 && placed < 2; c++) {
        if (sector.grid[r][c].kind === 'treasure-start') {
          sector.grid[r][c].treasures.push(nextTreasureId);
          treasureHome[nextTreasureId] = p.color;
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
    awaitingCast: null,
    treasureHome,
    treasureScorer: {},
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
// Extra Arms: carried items don't count toward hand limit.
export function handSize(p: PlayerState, hasExtraArms = false): number {
  const itemsCount = hasExtraArms ? 0 : p.carriedItems.length;
  return p.hand.length + itemsCount + p.maintainedSpells.length;
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
  const { seed, players, board, deck, discard, currentPlayer, turnNumber, phase, winner, log, nextObjectId, nextTreasureId, awaitingCast, treasureHome, treasureScorer } = state;
  return JSON.stringify({ seed, players, board, deck, discard, currentPlayer, turnNumber, phase, winner, log, nextObjectId, nextTreasureId, awaitingCast, treasureHome, treasureScorer });
}

export function deserialize(json: string): GameState {
  const data = JSON.parse(json);
  return { ...data, rng: mulberry32(data.seed) } as GameState;
}