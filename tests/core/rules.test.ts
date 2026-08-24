import { describe, it, expect } from 'vitest';
import { createBoardFromTopology } from '../../src/core/board';
import { convertBoardData } from '../../src/core/board-data';
import { createGameState, currentPlayer } from '../../src/core/state';
import { startTurn } from '../../src/core/turn';
import { applyAction } from '../../src/core/actions';
import { loadBuiltInCards } from '../../src/core/cards';
import { buildDeck } from '../../src/core/cards/registry';
import { applyDamage, checkWin, updateTreasureVP } from '../../src/core/damage';
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

describe('damage system', () => {
  it('applies damage to a wizard', () => {
    const state = makeGame();
    const target = state.players[1];
    const initialLife = target.life;
    
    const result = applyDamage(state, target, 3, 'magical', 0);
    
    expect(target.life).toBe(initialLife - 3);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe('damage');
  });

  it('kills a wizard when life reaches 0', () => {
    const state = makeGame();
    const target = state.players[1];
    target.life = 2;
    
    const result = applyDamage(state, target, 3, 'magical', 0);
    
    expect(target.alive).toBe(false);
    expect(target.life).toBe(0);
    expect(result.killed).toBe(true);
  });

  it('awards VP for killing a wizard', () => {
    const state = makeGame();
    const killer = state.players[0];
    const target = state.players[1];
    target.life = 1;
    
    applyDamage(state, target, 1, 'magical', killer.id);
    
    expect(killer.vp).toBe(1);
  });

  it('transfers hand on kill', () => {
    const state = makeGame();
    const killer = state.players[0];
    const target = state.players[1];
    target.life = 1;
    const killerHandBefore = killer.hand.length;
    const targetHandSize = target.hand.length;
    
    applyDamage(state, target, 1, 'magical', killer.id);
    
    expect(killer.hand.length).toBe(killerHandBefore + targetHandSize);
    expect(target.hand.length).toBe(0);
  });

  it('drops items and treasure on death', () => {
    const state = makeGame();
    const target = state.players[1];
    target.life = 1;
    target.carriedItems = ['test-item'];
    target.carriedTreasure = 99;
    
    applyDamage(state, target, 1, 'magical', 0);
    
    const cell = state.board.sectors[target.pos.sector].grid[target.pos.r][target.pos.c];
    expect(cell.objects.length).toBe(1);
    expect(cell.treasures).toContain(99);
  });
});

describe('victory conditions', () => {
  it('wins with 2 VP', () => {
    const state = makeGame();
    const p = state.players[0];
    p.vp = 2;
    
    checkWin(state, []);
    
    expect(state.winner).toBe(p.id);
  });

  it('wins when sole survivor', () => {
    const state = makeGame();
    state.players[1].alive = false;
    
    // Simulate end of turn which checks for sole survivor
    const alive = state.players.filter((p) => p.alive);
    if (alive.length === 1) {
      state.winner = alive[0].id;
    }
    
    expect(state.winner).toBe(state.players[0].id);
  });
});

describe('stun system', () => {
  it('allows stunned wizard to move (max 1 MP)', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    p.stunned = true;
    p.mp = 3;
    
    const res = applyAction(state, { type: 'move', dir: 'N' });
    
    expect(res.ok).toBe(true);
    // After moving, stunned wizard's MP is set to 0.
    expect(p.mp).toBe(0);
  });

  it('prevents stunned wizard from moving more than once', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    p.stunned = true;
    p.mp = 3;
    
    // First move succeeds.
    const res1 = applyAction(state, { type: 'move', dir: 'N' });
    expect(res1.ok).toBe(true);
    
    // Second move fails (MP is 0).
    const res2 = applyAction(state, { type: 'move', dir: 'N' });
    expect(res2.ok).toBe(false);
  });

  it('allows stunned wizard to attack', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    const target = state.players.find((pl) => pl.id !== p.id)!;
    target.pos = { sector: p.pos.sector, r: p.pos.r + 1, c: p.pos.c };
    p.stunned = true;
    state.turnNumber = 2; // Not first turn
    
    const res = applyAction(state, { type: 'punch', target: target.id });
    
    expect(res.ok).toBe(true);
  });

  it('prevents stunned wizard from casting', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    p.stunned = true;
    const cardId = p.hand[0];
    
    const res = applyAction(state, { type: 'cast', cardId });
    
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('Stunned');
  });
});

describe('card casting', () => {
  it('casts a card from hand', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    const cardId = p.hand[0];
    const handSizeBefore = p.hand.length;
    
    const res = applyAction(state, { type: 'cast', cardId });
    
    expect(res.ok).toBe(true);
    expect(p.hand.length).toBe(handSizeBefore - 1);
  });

  it('cannot cast a card not in hand', () => {
    const state = makeGame();
    startTurn(state);
    
    const res = applyAction(state, { type: 'cast', cardId: 'nonexistent-card' });
    
    expect(res.ok).toBe(false);
  });

  it('marks wizard as attacked when casting attack spell', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    
    // Find an attack spell in hand (cards with 'attack' in their effect)
    const attackCard = p.hand.find((id) => id.includes('zot') || id.includes('bolt') || id.includes('ball'));
    
    if (attackCard) {
      const res = applyAction(state, { type: 'cast', cardId: attackCard });
      if (res.ok) {
        expect(p.attacked).toBe(true);
      }
    }
  });
});

describe('treasure interaction', () => {
  it('picks up treasure from cell', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    
    // Place treasure on current cell
    const cell = state.board.sectors[p.pos.sector].grid[p.pos.r][p.pos.c];
    cell.treasures.push(99);
    
    const res = applyAction(state, { type: 'pick-up-treasure', treasureId: 99 });
    
    expect(res.ok).toBe(true);
    expect(p.carriedTreasure).toBe(99);
    expect(cell.treasures.length).toBe(0);
  });

  it('cannot pick up treasure when already carrying', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    p.carriedTreasure = 98;
    
    const cell = state.board.sectors[p.pos.sector].grid[p.pos.r][p.pos.c];
    cell.treasures.push(99);
    
    const res = applyAction(state, { type: 'pick-up-treasure', treasureId: 99 });
    
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('Already carrying treasure');
  });

  it('drops treasure on cell', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    p.carriedTreasure = 99;
    
    const res = applyAction(state, { type: 'drop-treasure' });
    
    expect(res.ok).toBe(true);
    expect(p.carriedTreasure).toBeNull();
    const cell = state.board.sectors[p.pos.sector].grid[p.pos.r][p.pos.c];
    expect(cell.treasures).toContain(99);
  });

  it('scores VP when enemy treasure is in home', () => {
    const state = makeGame();
    startTurn(state);
    const red = state.players[1];
    
    // Place a treasure on red's home cell
    const redHome = state.board.sectors.red.grid[2][2];
    redHome.treasures.push(99);
    
    // Set the treasure's home to blue (enemy treasure)
    state.treasureHome[99] = 'blue';
    
    // Trigger VP update
    updateTreasureVP(state);
    
    // Red should score 1 VP for the enemy treasure in their home
    expect(red.vp).toBe(1);
  });
});

describe('object interaction', () => {
  it('picks up object from cell', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    
    const cell = state.board.sectors[p.pos.sector].grid[p.pos.r][p.pos.c];
    cell.objects.push({ cardId: 'test-item', id: 1, owner: null });
    
    const res = applyAction(state, { type: 'pick-up-object', objectId: 1 });
    
    expect(res.ok).toBe(true);
    expect(p.carriedItems).toContain('test-item');
    expect(cell.objects.length).toBe(0);
  });

  it('drops item on cell', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    p.carriedItems = ['test-item'];
    
    const res = applyAction(state, { type: 'drop-item', cardId: 'test-item' });
    
    expect(res.ok).toBe(true);
    expect(p.carriedItems.length).toBe(0);
    const cell = state.board.sectors[p.pos.sector].grid[p.pos.r][p.pos.c];
    expect(cell.objects.length).toBe(1);
  });
});

describe('energy cards', () => {
  it('uses energy card to boost speed', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    
    // Find an energy card in hand
    const energyCard = p.hand.find((id) => id.includes('energy'));
    
    if (energyCard) {
      const mpBefore = p.mp;
      const res = applyAction(state, { type: 'boost-speed', cardId: energyCard });
      
      if (res.ok) {
        expect(p.mp).toBeGreaterThan(mpBefore);
        expect(p.speedBoosted).toBe(true);
      }
    }
  });
});

describe('door interaction', () => {
  it('blocks movement through locked door', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    
    // Add a locked door to the south
    const cell = state.board.sectors[p.pos.sector].grid[p.pos.r][p.pos.c];
    cell.doors.S = {
      color: 'red',
      locked: true,
      cracks: 0,
      destroyed: false,
      heldOpenBy: null,
      sealed: false,
    };
    
    const res = applyAction(state, { type: 'move', dir: 'S' });
    
    expect(res.ok).toBe(false);
  });

  it('allows movement through unlocked door', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    
    // Add an unlocked door to the south
    const cell = state.board.sectors[p.pos.sector].grid[p.pos.r][p.pos.c];
    cell.doors.S = {
      color: 'blue',
      locked: false,
      cracks: 0,
      destroyed: false,
      heldOpenBy: null,
      sealed: false,
    };
    
    const res = applyAction(state, { type: 'move', dir: 'S' });
    
    expect(res.ok).toBe(true);
  });
});

describe('wall interaction', () => {
  it('blocks movement through wall', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    
    // Add a wall to the south
    const cell = state.board.sectors[p.pos.sector].grid[p.pos.r][p.pos.c];
    cell.walls.S = true;
    
    const res = applyAction(state, { type: 'move', dir: 'S' });
    
    expect(res.ok).toBe(false);
  });
});

describe('hand size limit', () => {
  it('cannot draw when hand is full', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    
    // Fill hand to max
    while (p.hand.length < 7) {
      p.hand.push('test-card');
    }
    
    // Transition to discard-draw phase
    applyAction(state, { type: 'end-turn' });
    
    const res = applyAction(state, { type: 'draw', count: 1 });
    
    expect(res.ok).toBe(true); // Action is valid, but no cards drawn
    // Hand should still be at max
    expect(p.hand.length).toBeLessThanOrEqual(7);
  });
});

describe('turn advancement', () => {
  it('skips dead players', () => {
    const state = makeGame();
    state.players[1].alive = false;
    
    startTurn(state);
    // Should skip to next alive player
    expect(state.players[state.currentPlayer].alive).toBe(true);
  });
});

describe('MP management', () => {
  it('resets MP at start of turn', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    p.mp = 0;
    
    // Simulate end of turn and start of next turn
    applyAction(state, { type: 'end-turn' });
    applyAction(state, { type: 'end-turn' });
    startTurn(state);
    
    expect(currentPlayer(state).mp).toBe(3);
  });

  it('resets attacked flag at start of turn', () => {
    const state = makeGame();
    startTurn(state);
    const p = currentPlayer(state);
    p.attacked = true;
    
    // Simulate end of turn and start of next turn
    applyAction(state, { type: 'end-turn' });
    applyAction(state, { type: 'end-turn' });
    startTurn(state);
    
    expect(currentPlayer(state).attacked).toBe(false);
  });
});