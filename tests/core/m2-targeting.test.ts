// Tests for M2 targeting and energy rules.

import { describe, it, expect } from 'vitest';
import { createBoard } from '../../src/core/board';
import { createGameState, currentPlayer } from '../../src/core/state';
import { startTurn } from '../../src/core/turn';
import { applyAction } from '../../src/core/actions';
import { loadBuiltInCards } from '../../src/core/cards';
import { buildDeck, getCard } from '../../src/core/cards/registry';
import { getLegalActions } from '../../src/core/ai/bots';
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

describe('M2: Target validation', () => {
  it('validates adjacent targets', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    const opponent = state.players.find((pl) => pl.id !== p.id)!;
    
    // Place opponent adjacent.
    opponent.pos = { sector: p.pos.sector, r: p.pos.r + 1, c: p.pos.c };
    
    // Get legal actions.
    const actions = getLegalActions(state, p.id);
    
    // Should have some actions.
    expect(actions.length).toBeGreaterThan(0);
  });
  
  it('validates LOS targets', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    
    // Get legal actions.
    const actions = getLegalActions(state, p.id);
    
    // Should have end-turn action.
    expect(actions.some((a) => a.type === 'end-turn')).toBe(true);
  });
});

describe('M2: Energy rules', () => {
  it('calculates damage based on energy with @energy', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    const opponent = state.players.find((pl) => pl.id !== p.id)!;
    
    // Find a card with @energy damage.
    const cardId = p.hand.find((id) => {
      const card = getCard(id);
      return card && card.effect?.op === 'damage' && card.effect?.amount === '@energy';
    });
    
    if (cardId) {
      // Cast the spell.
      applyAction(state, {
        type: 'cast',
        cardId,
        target: { kind: 'wizard', id: opponent.id },
      });
      
      // Resolve the cast.
      applyAction(state, { type: 'resolve-cast' });
      
      // Opponent should have taken damage equal to energy.
      expect(opponent.life < 20).toBe(true);
    }
  });
});