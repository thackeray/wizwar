// Tests for M1 counter window (real path, no manual currentPlayer switching).

import { describe, it, expect } from 'vitest';
import { createBoard } from '../../src/core/board';
import { createGameState, currentPlayer } from '../../src/core/state';
import { startTurn } from '../../src/core/turn';
import { applyAction } from '../../src/core/actions';
import { loadBuiltInCards } from '../../src/core/cards';
import { buildDeck, getCard } from '../../src/core/cards/registry';
import type { GameState } from '../../src/core/types';

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

describe('M1: Counter window (real path)', () => {
  it('sets awaitingCast after cast, effect not resolved', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    
    // Cast a spell.
    const cardId = p.hand[0];
    const res = applyAction(state, { type: 'cast', cardId });
    
    expect(res.ok).toBe(true);
    expect(state.awaitingCast).not.toBeNull();
    expect(state.awaitingCast!.cardId).toBe(cardId);
    expect(state.awaitingCast!.countered).toBe(false);
  });
  
  it('resolves cast after resolve-cast action', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    
    // Cast a spell.
    const cardId = p.hand[0];
    applyAction(state, { type: 'cast', cardId });
    
    // Resolve the cast.
    const res = applyAction(state, { type: 'resolve-cast' });
    
    expect(res.ok).toBe(true);
    expect(state.awaitingCast).toBeNull();
  });
  
  it('counters cast with counter action (real path, no currentPlayer switch)', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    const opponent = state.players.find((pl) => pl.id !== p.id)!;
    
    // Give opponent a counter card.
    opponent.hand.push('cantrip-negate-neutral');

    // Cast a neutral spell. Force the hand so the test is deterministic:
    // cantrip-pick-lock is neutral-spell after the §18.1 reclassification.
    const neutralCardId = 'cantrip-pick-lock';
    p.hand.push(neutralCardId);

    applyAction(state, { type: 'cast', cardId: neutralCardId });

    // Counter the spell (as opponent, using playerId in action).
    const res = applyAction(state, {
      type: 'counter',
      cardId: 'cantrip-negate-neutral',
      playerId: opponent.id
    });

    expect(res.ok).toBe(true);
    // A successful counter voids the spell: awaitingCast is cleared (§15.3).
    expect(state.awaitingCast).toBeNull();
    // The countered spell's card goes to the discard pile.
    expect(state.discard).toContain(neutralCardId);
    // The counter card is consumed.
    expect(opponent.hand).not.toContain('cantrip-negate-neutral');
    expect(state.discard).toContain('cantrip-negate-neutral');
  });
  
  it('does not set attacked flag for countered attack spell', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    const opponent = state.players.find((pl) => pl.id !== p.id)!;
    
    // Set turn number to 2 to allow attacks.
    state.turnNumber = 2;
    
    // Give opponent a counter card.
    opponent.hand.push('cantrip-full-shield');
    
    // Cast an attack spell targeting opponent.
    const attackCardId = p.hand.find((id) => {
      const card = getCard(id);
      return card && card.type === 'attack-spell';
    });
    
    if (attackCardId) {
      applyAction(state, { 
        type: 'cast', 
        cardId: attackCardId,
        target: { kind: 'wizard', id: opponent.id }
      });
      
      // Counter the spell (as opponent, using playerId in action).
      const res = applyAction(state, { 
        type: 'counter', 
        cardId: 'cantrip-full-shield',
        playerId: opponent.id 
      });
      
      expect(res.ok).toBe(true);
      
      // Resolve the cast.
      applyAction(state, { type: 'resolve-cast' });
      
      // Attacked flag should not be set.
      expect(p.attacked).toBe(false);
    }
  });
});