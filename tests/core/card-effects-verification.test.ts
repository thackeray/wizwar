// Tests to verify card effects have real impact on game state.

import { describe, it, expect } from 'vitest';
import { createBoard } from '../../src/core/board';
import { createGameState } from '../../src/core/state';
import { buildDeck } from '../../src/core/cards/registry';
import { loadBuiltInCards } from '../../src/core/cards';
import { applyAction } from '../../src/core/actions';
import { startTurn, endTurn } from '../../src/core/turn';
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
  // Advance to turn 2 to allow attacks.
  startTurn(state); // Player 0, turn 1
  endTurn(state);   // End player 0's turn
  startTurn(state); // Player 1, turn 1
  endTurn(state);   // End player 1's turn
  startTurn(state); // Player 0, turn 2
  return state;
}

describe('Card Effect Verification: Real Game Impact', () => {
  describe('Windrider (move-line)', () => {
    it('should actually move the wizard on the board', () => {
      const state = makeGame();
      const p = state.players[0];
      const startPos = { ...p.pos };
      
      // Give player a Windrider card.
      p.hand.push('elemental-windrider');
      
      // Cast Windrider.
      const castResult = applyAction(state, {
        type: 'cast',
        cardId: 'elemental-windrider',
      });
      
      expect(castResult.ok).toBe(true);
      
      // Resolve the cast.
      const resolveResult = applyAction(state, {
        type: 'resolve-cast',
      });
      
      expect(resolveResult.ok).toBe(true);
      
      // Verify the wizard actually moved.
      expect(p.pos).not.toEqual(startPos);
      const distance = Math.abs(p.pos.r - startPos.r) + Math.abs(p.pos.c - startPos.c);
      expect(distance).toBeGreaterThan(0);
    });
  });

  describe('Around the Corner', () => {
    it('should store the buff on the caster', () => {
      const state = makeGame();
      const p = state.players[0];
      
      // Give player an Around the Corner card.
      p.hand.push('conjuring-around-the-corner');
      
      // Cast Around the Corner.
      const castResult = applyAction(state, {
        type: 'cast',
        cardId: 'conjuring-around-the-corner',
      });
      
      expect(castResult.ok).toBe(true);
      
      // Resolve the cast.
      const resolveResult = applyAction(state, {
        type: 'resolve-cast',
      });
      
      expect(resolveResult.ok).toBe(true);
      
      // Verify the buff is stored.
      const hasBuff = p.maintainedSpells.some(
        (spell) => spell.meta?.type === 'around-the-corner'
      );
      expect(hasBuff).toBe(true);
    });
  });

  describe('Add', () => {
    it('should store energy buff for next cast', () => {
      const state = makeGame();
      const p = state.players[0];
      
      // Give player an Add card.
      p.hand.push('alchemy-add');
      
      // Cast Add.
      const castResult = applyAction(state, {
        type: 'cast',
        cardId: 'alchemy-add',
      });
      
      expect(castResult.ok).toBe(true);
      
      // Resolve the cast.
      const resolveResult = applyAction(state, {
        type: 'resolve-cast',
      });
      
      expect(resolveResult.ok).toBe(true);
      
      // Verify the energy buff is stored.
      const hasBuff = p.maintainedSpells.some(
        (spell) => spell.meta?.type === 'add'
      );
      expect(hasBuff).toBe(true);
    });
  });

  describe('Homunculus (create-creature)', () => {
    it('should create a creature entity on the board', () => {
      const state = makeGame();
      const p = state.players[0];
      
      // Give player a Homunculus card.
      p.hand.push('alchemy-homunculus');
      
      // Find a valid target cell.
      const targetCell: CellRef = { sector: 'blue', r: 3, c: 3 };
      
      // Cast Homunculus.
      const castResult = applyAction(state, {
        type: 'cast',
        cardId: 'alchemy-homunculus',
        target: { kind: 'cell', ref: targetCell },
      });
      
      expect(castResult.ok).toBe(true);
      
      // Resolve the cast.
      const resolveResult = applyAction(state, {
        type: 'resolve-cast',
      });
      
      expect(resolveResult.ok).toBe(true);
      
      // Verify the creature is created on the board.
      const cell = state.board.sectors.blue.grid[3][3];
      const hasCreature = cell.objects.some(
        (obj) => obj.cardId === 'homunculus'
      );
      expect(hasCreature).toBe(true);
    });
  });

  describe('Fool\'s Gold', () => {
    it('should store the event hook on the caster', () => {
      const state = makeGame();
      const p = state.players[0];
      
      // Give player a Fool's Gold card.
      p.hand.push('alchemy-fool-s-gold');
      
      // Cast Fool's Gold.
      const castResult = applyAction(state, {
        type: 'cast',
        cardId: 'alchemy-fool-s-gold',
      });
      
      expect(castResult.ok).toBe(true);
      
      // Resolve the cast.
      const resolveResult = applyAction(state, {
        type: 'resolve-cast',
      });
      
      expect(resolveResult.ok).toBe(true);
      
      // Verify the event hook is stored.
      const hasHook = p.maintainedSpells.some(
        (spell) => spell.meta?.type === 'fools-gold'
      );
      expect(hasHook).toBe(true);
    });
  });

  describe('Damage Cards', () => {
    it('should actually reduce target HP', () => {
      const state = makeGame();
      const p1 = state.players[0];
      const p2 = state.players[1];
      const initialHP = p2.life;
      
      // Give player 1 a damage card.
      p1.hand.push('elemental-fireball');
      
      // Cast Fireball on player 2.
      const castResult = applyAction(state, {
        type: 'cast',
        cardId: 'elemental-fireball',
        target: { kind: 'wizard', id: p2.id },
      });
      
      expect(castResult.ok).toBe(true);
      
      // Resolve the cast.
      const resolveResult = applyAction(state, {
        type: 'resolve-cast',
      });
      
      expect(resolveResult.ok).toBe(true);
      
      // Verify player 2's HP is reduced.
      expect(p2.life).toBeLessThan(initialHP);
    });
  });

  });