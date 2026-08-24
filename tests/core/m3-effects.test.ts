// Tests for M3 continuous effects.

import { describe, it, expect } from 'vitest';
import { createBoard } from '../../src/core/board';
import { createGameState, currentPlayer } from '../../src/core/state';
import { startTurn } from '../../src/core/turn';
import { applyAction } from '../../src/core/actions';
import { loadBuiltInCards } from '../../src/core/cards';
import { buildDeck } from '../../src/core/cards/registry';
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

describe('M3: Time-passes damage', () => {
  it('applies time-passes damage to target when turn advances', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    const opponent = state.players.find((pl) => pl.id !== p.id)!;
    
    const initialLife = opponent.life;
    
    // Add a time-passes-damage spell to the player.
    p.maintainedSpells.push({
      cardId: 'acid-bath',
      energy: 3,
      target: { kind: 'wizard', id: opponent.id },
      owner: p.id,
      behavior: 'time-passes-damage',
      meta: { dmg: 2 },
    });
    
    // End turn (triggers time-passes for next player).
    applyAction(state, { type: 'end-turn' });
    
    // Start next turn (triggers time-passes).
    startTurn(state);
    
    // Opponent should have taken 2 damage.
    expect(opponent.life).toBe(initialLife - 2);
  });
});

describe('M3: Damage modifiers', () => {
  it('applies bloodshard damage reduction', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    const opponent = state.players.find((pl) => pl.id !== p.id)!;
    
    // Advance turn number to allow attacks.
    state.turnNumber = 2;
    
    // Move players to be adjacent.
    p.pos = { sector: 'blue', r: 0, c: 0 };
    opponent.pos = { sector: 'blue', r: 0, c: 1 };
    
    const initialLife = opponent.life;
    
    // Add bloodshard to opponent.
    opponent.maintainedSpells.push({
      cardId: 'bloodshard',
      energy: 3,
      target: null,
      owner: opponent.id,
      behavior: 'modifier',
      meta: { type: 'bloodshard' },
    });
    
    // Apply damage via punch.
    const res = applyAction(state, {
      type: 'punch',
      target: opponent.id,
    });
    
    expect(res.ok).toBe(true);
    // Punch deals 1 damage, bloodshard reduces by 1, so final damage is 0.
    expect(opponent.life).toBe(initialLife);
  });
});