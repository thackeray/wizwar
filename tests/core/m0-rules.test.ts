// Tests for M0 rule-enforcement fixes (R1-R12).
// Every test asserts a concrete outcome (no tautologies, no conditional skips).

import { describe, it, expect } from 'vitest';
import { createBoard, makeDoor, hasLOS, moveDestination } from '../../src/core/board';
import { createGameState, currentPlayer } from '../../src/core/state';
import { startTurn } from '../../src/core/turn';
import { applyAction } from '../../src/core/actions';
import { resolveTimePasses } from '../../src/core/damage';
import { loadBuiltInCards } from '../../src/core/cards';
import { buildDeck } from '../../src/core/cards/registry';
import type { GameState, Color } from '../../src/core/types';

function makeGame(seed = 42): GameState {
  loadBuiltInCards();
  const board = createBoard();
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

describe('R1: Cross-sector movement boundary check', () => {
  it('blocks movement through a wall on an interior sector boundary', () => {
    const state = makeGame();
    const board = state.board;
    // Blue east edge -> red west edge (interior seam of the 2x2 layout).
    board.sectors.blue.grid[0][4].walls.E = true;
    const dest = moveDestination(board, { sector: 'blue', r: 0, c: 4 }, 'E', 'blue');
    expect(dest).toBeNull();
  });

  it('allows crossing an interior sector boundary when no wall', () => {
    const state = makeGame();
    const dest = moveDestination(state.board, { sector: 'blue', r: 0, c: 4 }, 'E', 'blue');
    expect(dest).toEqual({ sector: 'red', r: 0, c: 0 });
  });
});

describe('R2: First turn attack ban', () => {
  it('prevents punching on the first turn', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    const target = state.players.find((pl) => pl.id !== p.id)!;
    target.pos = { sector: p.pos.sector, r: p.pos.r + 1, c: p.pos.c };

    const res = applyAction(state, { type: 'punch', target: target.id });

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('No attacks on first turn');
  });

  it('prevents casting an attack spell on the first turn', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    const target = state.players.find((pl) => pl.id !== p.id)!;
    p.hand.push('elemental-fireball');

    const res = applyAction(state, {
      type: 'cast',
      cardId: 'elemental-fireball',
      target: { kind: 'wizard', id: target.id },
    });

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('No attacks on first turn');
  });

  it('allows a neutral spell on the first turn', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    p.hand.push('cantrip-pick-lock');

    const res = applyAction(state, { type: 'cast', cardId: 'cantrip-pick-lock' });

    expect(res.ok).toBe(true);
  });
});

describe('R3: Door re-lock', () => {
  it('re-locks a door at time passes when the holder is no longer adjacent', () => {
    const state = makeGame();
    const p = currentPlayer(state);
    const cell = state.board.sectors[p.pos.sector].grid[p.pos.r][p.pos.c];
    cell.doors.S = makeDoor('blue', false);
    cell.doors.S.heldOpenBy = p.id;

    // startTurn runs time-passes, which re-locks held doors the holder left.
    startTurn(state);

    expect(cell.doors.S!.locked).toBe(true);
    expect(cell.doors.S!.heldOpenBy).toBeNull();
  });

  it('keeps a door open while the holder remains adjacent after passing through', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    const cell = state.board.sectors[p.pos.sector].grid[p.pos.r][p.pos.c];
    cell.doors.S = makeDoor('blue', false);
    cell.doors.S.heldOpenBy = p.id;

    const res = applyAction(state, { type: 'move', dir: 'S' });

    expect(res.ok).toBe(true);
    // Holder is now standing on the far side of the door, still adjacent.
    expect(cell.doors.S!.locked).toBe(false);
    expect(cell.doors.S!.heldOpenBy).toBe(p.id);
  });
});

describe('R4: Closed doors block LOS', () => {
  function doorBetweenCells(): { board: GameState['board']; from: { sector: Color; r: number; c: number }; to: { sector: Color; r: number; c: number } } {
    const board = createBoard();
    const from = { sector: 'blue' as Color, r: 1, c: 1 };
    const to = { sector: 'blue' as Color, r: 1, c: 3 };
    board.sectors.blue.grid[1][1].doors.E = makeDoor('blue', true);
    return { board, from, to };
  }

  it('blocks LOS through a closed door for a different-color observer', () => {
    const { board, from, to } = doorBetweenCells();
    expect(hasLOS(board, from, to, 'red')).toBe(false);
  });

  it('blocks LOS through a closed door when no observer color is given', () => {
    const { board, from, to } = doorBetweenCells();
    expect(hasLOS(board, from, to)).toBe(false);
  });

  it('allows LOS through a closed door of the observer color', () => {
    const { board, from, to } = doorBetweenCells();
    expect(hasLOS(board, from, to, 'blue')).toBe(true);
  });

  it('allows LOS through an open door', () => {
    const { board, from, to } = doorBetweenCells();
    board.sectors.blue.grid[1][1].doors.E!.locked = false;
    expect(hasLOS(board, from, to, 'red')).toBe(true);
  });
});

describe('R5: Treasure VP', () => {
  it('scores VP for enemy treasure in home sector', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);

    // Place an enemy treasure in the player's home sector.
    const homeCell = state.board.sectors[p.pos.sector].grid[0][0];
    expect(homeCell.kind).toBe('home');
    homeCell.treasures.push(999); // Enemy treasure.
    state.treasureHome[999] = 'red'; // Enemy color.

    // Trigger VP update.
    applyAction(state, { type: 'end-turn' });

    expect(p.vp).toBe(1);
  });
});

describe('R6: Attack objects', () => {
  it('allows attacking a static wall (tracks cracks)', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    state.turnNumber = 2;
    const cell = state.board.sectors[p.pos.sector].grid[p.pos.r][p.pos.c];
    cell.walls.S = true;
    const ref = { sector: p.pos.sector, r: p.pos.r, c: p.pos.c, side: 'S' as const };

    // 3 damage -> 1 crack, wall still standing.
    const res = applyAction(state, { type: 'attack-object', target: { kind: 'wall', ref }, power: 3 });
    expect(res.ok).toBe(true);
    expect(cell.wallCracks?.['S']).toBe(3);
    expect(cell.walls.S).toBe(true);
  });

  it('destroys a static wall after 5 cracks (15 damage)', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    state.turnNumber = 2;
    const cell = state.board.sectors[p.pos.sector].grid[p.pos.r][p.pos.c];
    cell.walls.S = true;
    const ref = { sector: p.pos.sector, r: p.pos.r, c: p.pos.c, side: 'S' as const };

    const res = applyAction(state, { type: 'attack-object', target: { kind: 'wall', ref }, power: 15 });
    expect(res.ok).toBe(true);
    expect(cell.walls.S).toBe(false);
  });

  it('destroys a door after 3 cracks', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    state.turnNumber = 2;
    const cell = state.board.sectors[p.pos.sector].grid[p.pos.r][p.pos.c];
    cell.doors.S = makeDoor('red', true);
    const ref = { sector: p.pos.sector, r: p.pos.r, c: p.pos.c, side: 'S' as const };

    const res = applyAction(state, { type: 'attack-object', target: { kind: 'door', ref }, power: 9 });
    expect(res.ok).toBe(true);
    expect(cell.doors.S!.destroyed).toBe(true);
  });

  it('rejects attacking an object on the first turn', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    const cell = state.board.sectors[p.pos.sector].grid[p.pos.r][p.pos.c];
    cell.walls.S = true;

    const res = applyAction(state, {
      type: 'attack-object',
      target: { kind: 'wall', ref: { sector: p.pos.sector, r: p.pos.r, c: p.pos.c, side: 'S' } },
    });

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('No attacks on first turn');
  });
});

describe('R7: Hand limit discard', () => {
  it('forces discard when hand exceeds limit', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);

    // Add cards to hand until it exceeds the limit (7).
    while (p.hand.length < 10) {
      p.hand.push('cantrip-energy');
    }

    // First end-turn: transition to discard-draw phase.
    applyAction(state, { type: 'end-turn' });

    // Second end-turn: actually end the turn (triggers forceDiscardToLimit).
    applyAction(state, { type: 'end-turn' });

    const playerWhoEnded = state.players.find((pl) => pl.id === p.id)!;
    expect(playerWhoEnded.hand.length <= 7).toBe(true);
  });
});

describe('R8: Time-passes energy decrement', () => {
  it('decrements temporary spell energy each time passes and removes at 0', () => {
    const state = makeGame();
    const p = currentPlayer(state);
    p.maintainedSpells.push({ cardId: 'cantrip-full-shield', energy: 2, target: null, owner: p.id });

    resolveTimePasses(state, p);
    expect(p.maintainedSpells[0].energy).toBe(1);

    resolveTimePasses(state, p);
    expect(p.maintainedSpells).toHaveLength(0);
    expect(state.discard).toContain('cantrip-full-shield');
  });
});

describe('R9: Stun rules', () => {
  it('allows stunned wizard to move (max 1 MP)', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    p.stunned = true;
    p.mp = 3;

    const res = applyAction(state, { type: 'move', dir: 'S' });

    expect(res.ok).toBe(true);
    expect(p.mp).toBe(0);
  });

  it('allows stunned wizard to attack', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    const target = state.players.find((pl) => pl.id !== p.id)!;
    target.pos = { sector: p.pos.sector, r: p.pos.r + 1, c: p.pos.c };
    p.stunned = true;
    state.turnNumber = 2;

    const res = applyAction(state, { type: 'punch', target: target.id });

    expect(res.ok).toBe(true);
  });

  it('prevents stunned wizard from casting', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    p.stunned = true;
    p.hand.push('cantrip-pick-lock');

    const res = applyAction(state, { type: 'cast', cardId: 'cantrip-pick-lock' });

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('Stunned');
  });
});

describe('R10: Target validation', () => {
  it('rejects a non-existent wizard target', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);

    const res = applyAction(state, {
      type: 'cast',
      cardId: p.hand[0],
      target: { kind: 'wizard', id: 999 },
    });

    expect(res.ok).toBe(false);
  });

  it('rejects a los spell targeting a wizard out of line of sight', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    const t = state.players[1];
    state.turnNumber = 2;
    p.hand.push('elemental-waterbolt');
    // A wall blocks the corridor between the two wizards.
    state.board.sectors.blue.grid[2][2].walls.E = true;
    t.pos = { sector: 'blue', r: 2, c: 4 };

    const res = applyAction(state, {
      type: 'cast',
      cardId: 'elemental-waterbolt',
      target: { kind: 'wizard', id: t.id },
    });

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('No line of sight');
  });

  it('accepts a los spell targeting a visible wizard', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    const t = state.players[1];
    state.turnNumber = 2;
    p.hand.push('elemental-waterbolt');
    t.pos = { sector: 'blue', r: 2, c: 3 };

    const res = applyAction(state, {
      type: 'cast',
      cardId: 'elemental-waterbolt',
      target: { kind: 'wizard', id: t.id },
    });

    expect(res.ok).toBe(true);
  });
});

describe('R11: Energy-based damage', () => {
  function castWaterbolt(fuel?: string): { state: GameState; target: GameState['players'][1]; p: GameState['players'][0] } {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    const target = state.players[1];
    state.turnNumber = 2;
    p.hand.push('elemental-waterbolt');
    if (fuel) p.hand.push(fuel);
    target.pos = { sector: 'blue', r: 2, c: 3 };
    return { state, target, p };
  }

  it('deals damage equal to the fuel energy value', () => {
    const { state, target } = castWaterbolt('cantrip-energy'); // energyValue 6
    const res = applyAction(state, {
      type: 'cast',
      cardId: 'elemental-waterbolt',
      energyCard: 'cantrip-energy',
      target: { kind: 'wizard', id: target.id },
    });
    expect(res.ok).toBe(true);

    applyAction(state, { type: 'resolve-cast' });
    expect(target.life).toBe(15 - 6);
  });

  it('uses the spell base energy when no fuel is provided', () => {
    const { state, target } = castWaterbolt();
    const res = applyAction(state, {
      type: 'cast',
      cardId: 'elemental-waterbolt',
      target: { kind: 'wizard', id: target.id },
    });
    expect(res.ok).toBe(true);

    applyAction(state, { type: 'resolve-cast' });
    expect(target.life).toBe(15 - 1); // waterbolt base energy = 1
  });
});

describe('R12: Energy card fuel logic', () => {
  it('consumes the energy card as fuel (hand -> discard)', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    const target = state.players[1];
    state.turnNumber = 2;
    p.hand.push('elemental-waterbolt');
    p.hand.push('cantrip-energy');
    target.pos = { sector: 'blue', r: 2, c: 3 };

    const res = applyAction(state, {
      type: 'cast',
      cardId: 'elemental-waterbolt',
      energyCard: 'cantrip-energy',
      target: { kind: 'wizard', id: target.id },
    });

    expect(res.ok).toBe(true);
    expect(p.hand).not.toContain('cantrip-energy');
    expect(state.discard).toContain('cantrip-energy');
  });

  it('rejects a card with no energy value as fuel', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    const target = state.players[1];
    state.turnNumber = 2;
    p.hand.push('elemental-waterbolt');
    p.hand.push('elemental-fireball'); // energyValue 0
    target.pos = { sector: 'blue', r: 2, c: 3 };

    const res = applyAction(state, {
      type: 'cast',
      cardId: 'elemental-waterbolt',
      energyCard: 'elemental-fireball',
      target: { kind: 'wizard', id: target.id },
    });

    expect(res.ok).toBe(false);
    expect(res.reason).toBe('Invalid energy card');
  });
});
