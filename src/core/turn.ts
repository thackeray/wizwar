// Turn flow: Time Passes -> Move & Cast -> Discard & Draw.

import type { GameState, PlayerState, Result, GameEvent } from './types';
import { addLog, currentPlayer, alivePlayers, handSize } from './state';
import { resolveTimePasses, hasModifier } from './damage';
import { applyLifestone, getBaseSpeed, getHandSize } from './passives';
import { getCard } from './cards/registry';

export function startTurn(state: GameState): Result {
  const p = currentPlayer(state);
  state.phase = 'time-passes';
  const events: GameEvent[] = [{ type: 'turn-start', playerId: p.id }];

  // 1. Time Passes phase.
  const tp = resolveTimePasses(state, p);
  events.push(...tp.events);
  if (state.winner !== null) {
    return { ok: true, events };
  }
  if (!p.alive) {
    // Player died during time passes; skip to next player.
    advancePlayer(state);
    return { ok: true, events };
  }

  // M5: Apply Lifestone passive.
  applyLifestone(state, p.id);

  // 2. Move & Cast phase: reset MP and attack.
  p.mp = getBaseSpeed(state, p.id);
  p.speedBoosted = false;
  p.attacked = false;
  p.attacksUsed = 0;
  p.stunned = p.stunTokens > 0;
  p.stunnedActionUsed = null; // Reset for new turn
  state.phase = 'move-cast';
  events.push({ type: 'phase', phase: 'move-cast' });
  addLog(state, p.id, `Turn ${state.turnNumber}: ${p.color} wizard's turn`);

  return { ok: true, events };
}

export function baseSpeed(p: PlayerState): number {
  // Transformed wizards may have different speed.
  if (p.transformed) {
    // Look up transform card speed.
    const card = getCard(p.transformed);
    if (card && card.baseSpeed !== undefined) {
      return card.baseSpeed;
    }
  }
  return 3;
}

export function endMoveCast(state: GameState): Result {
  const p = currentPlayer(state);
  state.phase = 'discard-draw';
  const events: GameEvent[] = [{ type: 'phase', phase: 'discard-draw' }];
  addLog(state, p.id, `${p.color} wizard ends Move & Cast`);
  return { ok: true, events };
}

export function endTurn(state: GameState): Result {
  const p = currentPlayer(state);
  const events: GameEvent[] = [];

  // R7: Force discard to hand size limit before advancing.
  forceDiscardToLimit(state, p);

  // Discard & Draw phase is handled by actions; here we just advance.
  advancePlayer(state);
  events.push({ type: 'turn-end', playerId: p.id });

  // Set phase to 'time-passes' so startTurn will be called for the new player.
  state.phase = 'time-passes';

  // Check for sole survivor win.
  const alive = alivePlayers(state);
  if (alive.length === 1) {
    state.winner = alive[0].id;
    events.push({ type: 'game-over', winner: alive[0].id });
    addLog(state, alive[0].id, `${alive[0].color} wizard is the sole survivor and wins!`);
  }

  return { ok: true, events };
}

// R7: Force a player to discard down to the hand size limit.
function forceDiscardToLimit(state: GameState, p: GameState['players'][0]): void {
  const limit = getHandSize(state, p.id);
  const hasExtraArms = hasModifier(state, p.id, 'extra-arms');
  while (handSize(p, hasExtraArms) > limit) {
    // Discard from hand first (last card).
    if (p.hand.length > 0) {
      const cardId = p.hand.pop()!;
      state.discard.push(cardId);
      addLog(state, p.id, `${p.color} wizard discards ${cardId} (hand limit)`);
    } else {
      break; // Nothing left to discard.
    }
  }
}

export function advancePlayer(state: GameState): void {
  const n = state.players.length;
  const prev = state.currentPlayer;
  let next = prev;
  for (let i = 0; i < n; i++) {
    next = (next + 1) % n;
    if (state.players[next].alive) break;
  }
  state.currentPlayer = next;
  // Increment global turn when we wrap around (next index <= prev index means we crossed the boundary).
  if (next <= prev) {
    state.turnNumber++;
  }
}

export function isFirstTurn(state: GameState): boolean {
  return state.turnNumber === 1;
}