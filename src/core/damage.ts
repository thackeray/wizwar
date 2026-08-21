// Damage, cracks, death, VP resolution.

import type {
  GameState,
  PlayerState,
  GameEvent,
  DamageKind,
} from './types';
import { addLog, MAX_LIFE } from './state';

export interface DamageResult {
  events: GameEvent[];
  killed: boolean;
}

// Apply damage to a wizard. Returns events and whether the wizard died.
export function applyDamage(
  state: GameState,
  target: PlayerState,
  amount: number,
  kind: DamageKind,
  source: number | null,
): DamageResult {
  if (amount <= 0 || !target.alive) {
    return { events: [], killed: false };
  }
  const events: GameEvent[] = [];
  target.life -= amount;
  events.push({ type: 'damage', target: target.id, amount, kind });
  addLog(state, source ?? -1, `${target.color} wizard takes ${amount} ${kind} damage (${target.life} life left)`);

  if (target.life <= 0) {
    killWizard(state, target, source, events);
    return { events, killed: true };
  }
  return { events, killed: false };
}

export function healWizard(
  state: GameState,
  target: PlayerState,
  amount: number,
): GameEvent[] {
  const events: GameEvent[] = [];
  const before = target.life;
  target.life = Math.min(MAX_LIFE, target.life + amount);
  const healed = target.life - before;
  if (healed > 0) {
    addLog(state, target.id, `${target.color} wizard heals ${healed} life (${target.life})`);
  }
  return events;
}

export function killWizard(
  state: GameState,
  target: PlayerState,
  killer: number | null,
  events: GameEvent[],
): void {
  target.alive = false;
  target.life = 0;
  events.push({ type: 'death', playerId: target.id, killer });
  addLog(state, killer ?? -1, `${target.color} wizard is eliminated!`);

  // Drop carried items in the square where they died.
  const cell = state.board.sectors[target.pos.sector].grid[target.pos.r][target.pos.c];
  for (const cardId of target.carriedItems) {
    cell.objects.push({ cardId, id: state.nextObjectId++, owner: null });
  }
  target.carriedItems = [];
  // Drop carried treasure.
  if (target.carriedTreasure !== null) {
    cell.treasures.push(target.carriedTreasure);
    target.carriedTreasure = null;
  }
  // Discard maintained spells.
  for (const spell of target.maintainedSpells) {
    state.discard.push(spell.cardId);
  }
  target.maintainedSpells = [];

  // Direct kill scores 1 VP and takes the hand.
  if (killer !== null) {
    const k = state.players.find((p) => p.id === killer)!;
    k.vp += 1;
    events.push({ type: 'vp', playerId: k.id, amount: 1 });
    addLog(state, k.id, `${k.color} wizard scores 1 VP for the kill`);
    // Take the killed wizard's hand (not carried items/spells).
    for (const cardId of target.hand) {
      k.hand.push(cardId);
    }
    target.hand = [];
  }

  checkWin(state, events);
}

export function checkWin(state: GameState, events: GameEvent[]): void {
  if (state.winner !== null) return;
  for (const p of state.players) {
    if (p.alive && p.vp >= 2) {
      state.winner = p.id;
      events.push({ type: 'game-over', winner: p.id });
      addLog(state, p.id, `${p.color} wizard reaches 2 VP and wins!`);
      return;
    }
  }
}

// Resolve "when time passes" effects for a player's turn.
export function resolveTimePasses(
  state: GameState,
  p: PlayerState,
): { events: GameEvent[] } {
  const events: GameEvent[] = [];

  // 1. Resolve "when time passes" spell effects.
  // (Handled by specific card effects; placeholder for now.)

  // 2. Remove 1 energy from each maintained temporary spell.
  for (let i = p.maintainedSpells.length - 1; i >= 0; i--) {
    const spell = p.maintainedSpells[i];
    spell.energy -= 1;
    if (spell.energy <= 0) {
      p.maintainedSpells.splice(i, 1);
      state.discard.push(spell.cardId);
      addLog(state, p.id, `${p.color} wizard's spell ends (energy depleted)`);
    }
  }

  // 3. Remove stun.
  if (p.stunTokens > 0) {
    p.stunTokens -= 1;
    p.stunned = true;
    addLog(state, p.id, `${p.color} wizard is stunned this turn`);
  } else {
    p.stunned = false;
  }

  return { events };
}

// Apply damage to an object (wall/door). Returns cracks added.
export function damageObject(
  obj: { cracks: number; destroyed: boolean },
  amount: number,
): number {
  if (obj.destroyed) return 0;
  const newCracks = Math.floor((obj.cracks + amount) / 3) - Math.floor(obj.cracks / 3);
  obj.cracks += amount;
  return newCracks;
}