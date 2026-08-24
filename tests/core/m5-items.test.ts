// M5: Tests for items, weapons, creatures, and passives.

import { describe, it, expect } from 'vitest';
import { createBoard } from '../../src/core/board';
import { createGameState } from '../../src/core/state';
import { startTurn } from '../../src/core/turn';
import { applyAction } from '../../src/core/actions';
import { loadBuiltInCards } from '../../src/core/cards';
import { buildDeck } from '../../src/core/cards/registry';
import { getPassives, getHandSize, getBaseSpeed, getFuelEnergy } from '../../src/core/passives';
import type { GameState, CellRef } from '../../src/core/types';

function makeGame(seed = 42): GameState {
  loadBuiltInCards();
  const board = createBoard();
  const deck = buildDeck(['cantrip', 'alchemy', 'elemental']);
  const state = createGameState(
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
  startTurn(state);
  return state;
}

describe('M5: Magic Stone Passives', () => {
  it('should detect Lifestone passive', () => {
    const state = makeGame();
    const p = state.players[0];
    p.carriedItems.push('alchemy-lifestone');
    
    const passives = getPassives(state, p.id);
    expect(passives.lifestone).toBe(true);
  });

  it('should detect Brainstone passive and modify hand size', () => {
    const state = makeGame();
    const p = state.players[0];
    p.carriedItems.push('alchemy-brainstone');
    
    const passives = getPassives(state, p.id);
    expect(passives.brainstone).toBe(true);
    
    const handSize = getHandSize(state, p.id);
    expect(handSize).toBe(9); // 7 base + 2 from Brainstone
  });

  it('should detect Speedstone passive and modify base speed', () => {
    const state = makeGame();
    const p = state.players[0];
    p.carriedItems.push('alchemy-speedstone');
    
    const passives = getPassives(state, p.id);
    expect(passives.speedstone).toBe(true);
    
    const speed = getBaseSpeed(state, p.id);
    expect(speed).toBe(4); // 3 base + 1 from Speedstone
  });

  it('should detect Powerstone passive and modify fuel energy', () => {
    const state = makeGame();
    const p = state.players[0];
    p.carriedItems.push('alchemy-powerstone');
    
    const passives = getPassives(state, p.id);
    expect(passives.powerstone).toBe(true);
    
    const energy = getFuelEnergy(state, p.id, 5);
    expect(energy).toBe(6); // 5 base + 1 from Powerstone
  });

  it('should detect Mightstone passive', () => {
    const state = makeGame();
    const p = state.players[0];
    p.carriedItems.push('alchemy-mightstone');
    
    const passives = getPassives(state, p.id);
    expect(passives.mightstone).toBe(true);
  });

  it('should detect Null Powder passive', () => {
    const state = makeGame();
    const p = state.players[0];
    p.carriedItems.push('alchemy-null-powder');
    
    const passives = getPassives(state, p.id);
    expect(passives.nullPowder).toBe(true);
  });
});

describe('M5: Object Placement Validation', () => {
  it('should not allow creating objects on home cells', () => {
    const state = makeGame();
    
    // Find a home cell.
    const homeCell: CellRef = { sector: 'blue', r: 0, c: 0 };
    const cell = state.board.sectors.blue.grid[0][0];
    expect(cell.kind).toBe('home');
    
    // Try to create an object on the home cell.
    const result = applyAction(state, {
      type: 'cast',
      cardId: 'conjuring-create-wall',
      target: { kind: 'cell', ref: homeCell },
    });
    
    // Should fail because it's a home cell.
    expect(result.ok).toBe(false);
  });

  it('should not allow creating objects on cells with existing objects', () => {
    const state = makeGame();
    
    // Find a non-home cell.
    const targetCell: CellRef = { sector: 'blue', r: 2, c: 2 };
    const cell = state.board.sectors.blue.grid[2][2];
    expect(cell.kind).not.toBe('home');
    
    // Add an object to the cell.
    cell.objects.push({ cardId: 'test-object', id: 999, owner: null });
    
    // Try to create another object on the same cell.
    const result = applyAction(state, {
      type: 'cast',
      cardId: 'conjuring-create-wall',
      target: { kind: 'cell', ref: targetCell },
    });
    
    // Should fail because the cell already has an object.
    expect(result.ok).toBe(false);
  });
});

describe('M5: Object Blocking', () => {
  it('should prevent moving into cells with Stone Block', () => {
    const state = makeGame();
    
    // Player starts at { sector: 'blue', r: 2, c: 2 }.
    // Place a Stone Block in front of the player (South).
    const cell = state.board.sectors.blue.grid[3][2];
    cell.objects.push({ cardId: 'cantrip-stone-block', id: 999, owner: null });
    
    // Try to move into the cell with the Stone Block.
    const result = applyAction(state, {
      type: 'move',
      dir: 'S',
    });
    
    // Should fail because the cell is blocked.
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('Blocked by object');
  });
});

describe('M5: Entry Triggers', () => {
  it('should trigger Booby Trap when entering a cell', () => {
    const state = makeGame();
    const p = state.players[0];
    const initialLife = p.life;
    
    // Player starts at { sector: 'blue', r: 2, c: 2 }.
    // Place a Booby Trap in front of the player (South).
    const cell = state.board.sectors.blue.grid[3][2];
    cell.objects.push({ cardId: 'conjuring-booby-trap', id: 999, owner: null });
    
    // Move into the cell with the Booby Trap.
    const result = applyAction(state, {
      type: 'move',
      dir: 'S',
    });
    
    // Should succeed (move is allowed) but trigger the trap.
    expect(result.ok).toBe(true);
    expect(p.life).toBeLessThan(initialLife); // Player took damage.
  });
});

describe('M5: Object Destruction', () => {
  it('should destroy thornbush with 1 crack', () => {
    const state = makeGame();
    
    // Advance to second turn (attacks allowed).
    applyAction(state, { type: 'end-turn' }); // End move-cast
    applyAction(state, { type: 'end-turn' }); // End discard-draw
    startTurn(state); // Start player 1's turn
    applyAction(state, { type: 'end-turn' }); // End player 1's move-cast
    applyAction(state, { type: 'end-turn' }); // End player 1's discard-draw
    startTurn(state); // Start player 0's turn (turn 2)
    
    // Place a thornbush.
    const cell = state.board.sectors.blue.grid[2][2];
    const objId = 999;
    cell.objects.push({ cardId: 'conjuring-thornbush', id: objId, owner: null, cracks: 0 });
    
    // Attack the thornbush.
    const result = applyAction(state, {
      type: 'attack-object',
      target: { kind: 'object', id: objId },
      power: 1,
    });
    
    // Should succeed and destroy the thornbush.
    expect(result.ok).toBe(true);
    expect(cell.objects.find((o) => o.id === objId)).toBeUndefined();
  });
});
describe('§21: Items usable from hand (not just carried)', () => {
  it('magic stone passive applies from hand', () => {
    const state = makeGame();
    const p = state.players[0];
    p.hand.push('alchemy-lifestone');
    expect(getPassives(state, p.id).lifestone).toBe(true);
  });

  it('weapon can be used from hand', () => {
    const state = makeGame();
    const p = state.players[0];
    const t = state.players[1];
    t.life = 15;
    state.turnNumber = 2;
    p.hand.push('thaumaturgy-wizardblade');
    const res = applyAction(state, {
      type: 'use-item',
      cardId: 'thaumaturgy-wizardblade',
      target: { kind: 'wizard', id: t.id },
    });
    expect(res.ok).toBe(true);
    expect(t.life).toBeLessThan(15); // dealt damage
  });
});
