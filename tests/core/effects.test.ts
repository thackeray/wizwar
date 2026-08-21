import { describe, it, expect } from 'vitest';
import { createBoard } from '../../src/core/board';
import { createGameState } from '../../src/core/state';
import { loadBuiltInCards } from '../../src/core/cards';
import { buildDeck } from '../../src/core/cards/registry';
import { resolveEffect } from '../../src/core/cards/effects';
import { getCard } from '../../src/core/cards/registry';
import type { GameState } from '../../src/core/types';

function makeGame(): GameState {
  loadBuiltInCards();
  const board = createBoard();
  const deck = buildDeck(['cantrip', 'mentalism', 'thaumaturgy']);
  return createGameState(
    {
      seed: 42,
      playerColors: ['blue', 'red'],
      botSeats: [false, false],
      schools: ['cantrip', 'mentalism', 'thaumaturgy'],
      cantripSchool: 'cantrip',
    },
    board,
    deck,
  );
}

describe('spell effects', () => {
  it('share-life averages life between two wizards', () => {
    const state = makeGame();
    const caster = state.players[0];
    const target = state.players[1];
    caster.life = 10;
    target.life = 4;
    const card = getCard('mentalism-share-life')!;
    resolveEffect(state, caster, card, { kind: 'wizard', id: target.id }, 1);
    // total 14 -> caster 7, target 7
    expect(caster.life).toBe(7);
    expect(target.life).toBe(7);
  });

  it('share-life gives caster the extra point on odd total', () => {
    const state = makeGame();
    const caster = state.players[0];
    const target = state.players[1];
    caster.life = 10;
    target.life = 5;
    const card = getCard('mentalism-share-life')!;
    resolveEffect(state, caster, card, { kind: 'wizard', id: target.id }, 1);
    // total 15 -> caster 8, target 7
    expect(caster.life).toBe(8);
    expect(target.life).toBe(7);
  });

  it('drop-object forces target to drop a carried item', () => {
    const state = makeGame();
    const caster = state.players[0];
    const target = state.players[1];
    target.carriedItems.push('cantrip-large-rock');
    const card = getCard('cantrip-drop-object')!;
    resolveEffect(state, caster, card, { kind: 'wizard', id: target.id }, 1);
    expect(target.carriedItems).toHaveLength(0);
    const cell = state.board.sectors[target.pos.sector].grid[target.pos.r][target.pos.c];
    expect(cell.objects).toHaveLength(1);
  });

  it('drop-object forces target to drop carried treasure', () => {
    const state = makeGame();
    const caster = state.players[0];
    const target = state.players[1];
    target.carriedTreasure = 99;
    const card = getCard('cantrip-drop-object')!;
    resolveEffect(state, caster, card, { kind: 'wizard', id: target.id }, 1);
    expect(target.carriedTreasure).toBeNull();
    const cell = state.board.sectors[target.pos.sector].grid[target.pos.r][target.pos.c];
    expect(cell.treasures).toContain(99);
  });

  it('negate ends a maintained spell on the target', () => {
    const state = makeGame();
    const caster = state.players[0];
    const target = state.players[1];
    target.maintainedSpells.push({ cardId: 'cantrip-full-shield', energy: 3, target: null, owner: target.id });
    const card = getCard('cantrip-dispel')!;
    resolveEffect(state, caster, card, { kind: 'wizard', id: target.id }, 1);
    expect(target.maintainedSpells).toHaveLength(0);
    expect(state.discard).toContain('cantrip-full-shield');
  });

  it('seal-door marks a door as sealed', () => {
    const state = makeGame();
    const caster = state.players[0];
    // Place a door on the board.
    const cell = state.board.sectors.blue.grid[3][3];
    cell.doors.E = { color: 'red', locked: true, cracks: 0, destroyed: false, heldOpenBy: null, sealed: false };
    const card = getCard('thaumaturgy-seal-door')!;
    resolveEffect(state, caster, card, { kind: 'door', ref: { sector: 'blue', r: 3, c: 3, side: 'E' } }, 1);
    expect(cell.doors.E!.sealed).toBe(true);
  });

  it('pick-lock unlocks a door', () => {
    const state = makeGame();
    const caster = state.players[0];
    const cell = state.board.sectors.blue.grid[3][3];
    cell.doors.E = { color: 'red', locked: true, cracks: 0, destroyed: false, heldOpenBy: null, sealed: false };
    const card = getCard('cantrip-pick-lock')!;
    resolveEffect(state, caster, card, { kind: 'door', ref: { sector: 'blue', r: 3, c: 3, side: 'E' } }, 1);
    expect(cell.doors.E!.locked).toBe(false);
    expect(cell.doors.E!.heldOpenBy).toBe(caster.id);
  });

  it('pick-lock does not open a sealed door', () => {
    const state = makeGame();
    const caster = state.players[0];
    const cell = state.board.sectors.blue.grid[3][3];
    cell.doors.E = { color: 'red', locked: true, cracks: 0, destroyed: false, heldOpenBy: null, sealed: true };
    const card = getCard('cantrip-pick-lock')!;
    resolveEffect(state, caster, card, { kind: 'door', ref: { sector: 'blue', r: 3, c: 3, side: 'E' } }, 1);
    expect(cell.doors.E!.locked).toBe(true);
  });
});