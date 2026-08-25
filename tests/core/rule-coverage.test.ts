// Coverage for DESIGN §10 rule memoranda that previously had no meaningful
// tests: life caps, indirect kills, transformation, own-color doors, portals,
// draw limits, treasure-pickup phase end, hand-size accounting, boost-speed.

import { describe, it, expect } from 'vitest';
import { createBoard, makeDoor, hasLOS, moveDestination } from '../../src/core/board';
import { createGameState, currentPlayer, handSize } from '../../src/core/state';
import { startTurn } from '../../src/core/turn';
import { applyAction } from '../../src/core/actions';
import { applyDamage, healWizard, resolveTimePasses } from '../../src/core/damage';
import { getBaseSpeed } from '../../src/core/passives';
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

describe('Life: start value and cap', () => {
  it('starts wizards at 15 life', () => {
    const state = makeGame();
    expect(state.players[0].life).toBe(15);
    expect(state.players[1].life).toBe(15);
  });

  it('caps healing at 20 life', () => {
    const state = makeGame();
    const p = currentPlayer(state);
    p.life = 19;
    healWizard(state, p, 5);
    expect(p.life).toBe(20);
  });
});

describe('Indirect kills score no VP and take no hand', () => {
  it('does not award VP when the killer is null (indirect kill)', () => {
    const state = makeGame();
    const p = currentPlayer(state);
    const target = state.players[1];
    target.life = 1;
    const handBefore = target.hand.length;

    const res = applyDamage(state, target, 1, 'magical', null);

    expect(res.killed).toBe(true);
    expect(target.alive).toBe(false);
    expect(p.vp).toBe(0);
    // Hand is NOT taken for an indirect kill.
    expect(target.hand).toHaveLength(handBefore);
  });

  it('awards VP and takes the hand for a direct kill', () => {
    const state = makeGame();
    const p = currentPlayer(state);
    const target = state.players[1];
    target.life = 1;

    applyDamage(state, target, 1, 'magical', p.id);

    expect(p.vp).toBe(1);
    expect(target.hand).toHaveLength(0);
    expect(p.hand.length).toBeGreaterThan(0);
  });
});

describe('Transformation (变形)', () => {
  it('sets transformed state and changes base speed while active', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    p.hand.push('mutation-gnome-form'); // transform, temporary, baseSpeed 2, energy 1

    const cast = applyAction(state, { type: 'cast', cardId: 'mutation-gnome-form' });
    expect(cast.ok).toBe(true);
    applyAction(state, { type: 'resolve-cast' });

    expect(p.transformed).toBe('mutation-gnome-form');
    expect(getBaseSpeed(state, p.id)).toBe(2);
  });

  it('ends the temporary transformation when its energy depletes at time passes', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    p.hand.push('mutation-gnome-form');
    applyAction(state, { type: 'cast', cardId: 'mutation-gnome-form' });
    applyAction(state, { type: 'resolve-cast' });

    resolveTimePasses(state, p); // transformEnergy 1 -> 0

    expect(p.transformed).toBeNull();
    expect(getBaseSpeed(state, p.id)).toBe(3);
  });
});

describe('Doors: own color opens automatically', () => {
  it('lets a wizard move through a locked door of their own color', () => {
    const board = createBoard();
    board.sectors.blue.grid[1][1].doors.E = makeDoor('blue', true); // locked, blue
    const from = { sector: 'blue' as Color, r: 1, c: 1 };
    expect(moveDestination(board, from, 'E', 'blue')).toEqual({ sector: 'blue', r: 1, c: 2 });
  });

  it('blocks a wizard moving through a locked door of another color', () => {
    const board = createBoard();
    board.sectors.blue.grid[1][1].doors.E = makeDoor('blue', true); // locked, blue
    const from = { sector: 'blue' as Color, r: 1, c: 1 };
    expect(moveDestination(board, from, 'E', 'red')).toBeNull();
  });
});

describe('Portals: movement and LOS adjacency', () => {
  it('teleports through a portal edge to the paired edge', () => {
    const board = createBoard();
    board.portals = [
      { color: 'purple', a: { sector: 'blue', edge: 'N', index: 2 }, b: { sector: 'green', edge: 'S', index: 2 } },
    ];
    const from = { sector: 'blue' as Color, r: 0, c: 2 };
    expect(moveDestination(board, from, 'N', 'blue')).toEqual({ sector: 'green', r: 4, c: 2 });
  });

  it('treats portal-connected cells as mutually visible (LOS)', () => {
    const board = createBoard();
    board.portals = [
      { color: 'purple', a: { sector: 'blue', edge: 'N', index: 2 }, b: { sector: 'green', edge: 'S', index: 2 } },
    ];
    const from = { sector: 'blue' as Color, r: 0, c: 2 };
    const to = { sector: 'green' as Color, r: 4, c: 2 };
    expect(hasLOS(board, from, to)).toBe(true);
  });
});

describe('Discard & Draw: draw limit', () => {
  it('limits drawing to 2 cards per turn', () => {
    const state = makeGame();
    startTurn(state);
    // Move & Cast -> Discard & Draw.
    applyAction(state, { type: 'end-turn' });
    const p = currentPlayer(state);
    const handBefore = p.hand.length;

    const res3 = applyAction(state, { type: 'draw', count: 3 });
    expect(res3.ok).toBe(false);
    expect(res3.reason).toBe('Can only draw up to 2');

    const res2 = applyAction(state, { type: 'draw', count: 2 });
    expect(res2.ok).toBe(true);
    // Drawing is capped by the hand-size limit (7).
    expect(p.hand.length).toBe(Math.min(handBefore + 2, 7));
  });
});

describe('Treasure: pickup ends the phase', () => {
  it('moves to discard-draw immediately after picking up a treasure', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    const cell = state.board.sectors[p.pos.sector].grid[p.pos.r][p.pos.c];
    cell.treasures.push(99);
    state.treasureHome[99] = 'red';

    const res = applyAction(state, { type: 'pick-up-treasure', treasureId: 99 });

    expect(res.ok).toBe(true);
    expect(p.carriedTreasure).toBe(99);
    expect(state.phase).toBe('discard-draw');
  });
});

describe('Hand-size accounting', () => {
  it('counts carried items toward the hand-size cap', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    p.hand = Array(6).fill('cantrip-energy');
    p.carriedItems = ['cantrip-full-shield', 'cantrip-dispel'];

    expect(handSize(p)).toBe(8); // 6 hand + 2 carried

    // Ending the turn forces the discard down to the limit (7).
    applyAction(state, { type: 'end-turn' }); // -> discard-draw
    applyAction(state, { type: 'end-turn' }); // force discard + advance
    expect(handSize(state.players[0])).toBe(7);
  });

  it('does not count a carried treasure toward the hand-size cap', () => {
    const state = makeGame();
    const p = currentPlayer(state);
    p.carriedTreasure = 99;
    expect(handSize(p)).toBe(p.hand.length + p.carriedItems.length);
  });
});

describe('Energy cards: boost speed once per turn', () => {
  it('adds MP on boost and rejects a second boost in the same turn', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    p.hand.push('cantrip-energy'); // energyValue 6
    p.hand.push('cantrip-energy');

    const res = applyAction(state, { type: 'boost-speed', cardId: 'cantrip-energy' });
    expect(res.ok).toBe(true);
    expect(p.mp).toBe(3 + 6);
    expect(p.speedBoosted).toBe(true);

    const res2 = applyAction(state, { type: 'boost-speed', cardId: 'cantrip-energy' });
    expect(res2.ok).toBe(false);
    expect(res2.reason).toBe('Already boosted');
  });
});
