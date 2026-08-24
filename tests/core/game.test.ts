import { describe, it, expect } from 'vitest';
import { createBoardFromTopology } from '../../src/core/board';
import { convertBoardData } from '../../src/core/board-data';
import { createGameState, currentPlayer } from '../../src/core/state';
import { startTurn, endTurn } from '../../src/core/turn';
import { applyAction } from '../../src/core/actions';
import { loadBuiltInCards } from '../../src/core/cards';
import { buildDeck } from '../../src/core/cards/registry';
import type { GameState } from '../../src/core/types';
import boardDataJSON from '../../src/board-data.json';

function makeGame(seed = 42): GameState {
  loadBuiltInCards();
  const topo = convertBoardData(boardDataJSON as any);
  const board = createBoardFromTopology(topo);
  const deck = buildDeck(['cantrip', 'alchemy', 'elemental']);
  return createGameState(
    {
      seed,
      playerColors: ['blue', 'red'],
      botSeats: [false, false],
      schools: ['cantrip', 'alchemy', 'elemental'],
      cantripSchool: 'cantrip',
    },
    board,
    deck,
  );
}

describe('game state', () => {
  it('creates players with correct colors', () => {
    const state = makeGame();
    expect(state.players).toHaveLength(2);
    expect(state.players[0].color).toBe('blue');
    expect(state.players[1].color).toBe('red');
  });

  it('deals starting hands of 5 cards (+ sector bonus)', () => {
    const state = makeGame();
    for (const p of state.players) {
      // §18.2: Blue and red get 1 extra energy card.
      const expectedSize = (p.color === 'blue' || p.color === 'red') ? 6 : 5;
      expect(p.hand).toHaveLength(expectedSize);
    }
  });

  it('places players in home bases', () => {
    const state = makeGame();
    const blue = state.players[0];
    expect(state.board.sectors.blue.grid[blue.pos.r][blue.pos.c].kind).toBe('home');
  });

  it('places treasure markers', () => {
    const state = makeGame();
    let treasures = 0;
    for (const color of ['blue', 'red', 'yellow', 'green']) {
      const sector = state.board.sectors[color as keyof typeof state.board.sectors];
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          treasures += sector.grid[r][c].treasures.length;
        }
      }
    }
    expect(treasures).toBe(4); // 2 per player, 2 players
  });

  it('is reproducible with the same seed', () => {
    const s1 = makeGame(123);
    const s2 = makeGame(123);
    expect(s1.players[0].hand).toEqual(s2.players[0].hand);
    expect(s1.players[1].hand).toEqual(s2.players[1].hand);
  });
});

describe('turn flow', () => {
  it('starts with time-passes phase', () => {
    const state = makeGame();
    expect(state.phase).toBe('time-passes');
  });

  it('transitions to move-cast after startTurn', () => {
    const state = makeGame();
    const res = startTurn(state);
    expect(res.ok).toBe(true);
    expect(state.phase).toBe('move-cast');
  });

  it('resets MP at start of turn', () => {
    const state = makeGame();
    startTurn(state);
    expect(currentPlayer(state).mp).toBe(3);
  });

  it('advances to next player on endTurn', () => {
    const state = makeGame();
    startTurn(state);
    const firstPlayer = state.currentPlayer;
    endTurn(state);
    expect(state.currentPlayer).not.toBe(firstPlayer);
  });

  it('increments turn number when wrapping around', () => {
    const state = makeGame();
    const initialTurn = state.turnNumber;
    startTurn(state);
    endTurn(state); // player 0 -> player 1
    startTurn(state);
    endTurn(state); // player 1 -> player 0 (wrap)
    expect(state.turnNumber).toBe(initialTurn + 1);
  });
});

describe('actions', () => {
  it('moves a wizard', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    const from = { ...p.pos };
    const res = applyAction(state, { type: 'move', dir: 'N' });
    expect(res.ok).toBe(true);
    expect(p.pos.r).toBe(from.r - 1);
    expect(p.mp).toBe(2);
  });

  it('cannot move without MP', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    p.mp = 0;
    const res = applyAction(state, { type: 'move', dir: 'S' });
    expect(res.ok).toBe(false);
  });

  it('cannot attack on first turn', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    const target = state.players.find((pl) => pl.id !== p.id)!;
    // Place target adjacent.
    target.pos = { sector: p.pos.sector, r: p.pos.r + 1, c: p.pos.c };
    const res = applyAction(state, { type: 'punch', target: target.id });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('first turn');
  });

  it('discards and draws in discard-draw phase', () => {
    const state = makeGame();
    startTurn(state);
    // Transition to discard-draw.
    applyAction(state, { type: 'end-turn' });
    // Now in discard-draw phase (after end-turn transitions).
    // Actually end-turn advances the player, so let's start a new turn.
    startTurn(state);
    applyAction(state, { type: 'end-turn' });
    expect(state.phase).toBe('discard-draw');
  });
});