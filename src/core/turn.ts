// Turn flow: Time Passes -> Move & Cast -> Discard & Draw.

import type { GameState, PlayerState, Result, GameEvent } from './types';
import { addLog, currentPlayer, alivePlayers } from './state';
import { resolveTimePasses } from './damage';

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

  // 2. Move & Cast phase: reset MP and attack.
  p.mp = baseSpeed(p);
  p.speedBoosted = false;
  p.attacked = false;
  p.stunned = p.stunTokens > 0;
  state.phase = 'move-cast';
  events.push({ type: 'phase', phase: 'move-cast' });
  addLog(state, p.id, `Turn ${state.turnNumber}: ${p.color} wizard's turn`);

  return { ok: true, events };
}

export function baseSpeed(p: PlayerState): number {
  // Transformed wizards may have different speed.
  if (p.transformed) {
    // Look up transform card speed (handled in effects).
    return 3; // default; overridden by transform logic
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

  // Discard & Draw phase is handled by actions; here we just advance.
  advancePlayer(state);
  events.push({ type: 'turn-end', playerId: p.id });

  // Check for sole survivor win.
  const alive = alivePlayers(state);
  if (alive.length === 1) {
    state.winner = alive[0].id;
    events.push({ type: 'game-over', winner: alive[0].id });
    addLog(state, alive[0].id, `${alive[0].color} wizard is the sole survivor and wins!`);
  }

  return { ok: true, events };
}

export function advancePlayer(state: GameState): void {
  const n = state.players.length;
  let next = state.currentPlayer;
  for (let i = 0; i < n; i++) {
    next = (next + 1) % n;
    if (state.players[next].alive) break;
  }
  state.currentPlayer = next;
  // Increment global turn when we wrap around to the first player.
  if (next === 0) {
    state.turnNumber++;
  }
}

export function isFirstTurn(state: GameState): boolean {
  return state.turnNumber === 1;
}