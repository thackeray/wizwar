// Damage, cracks, death, VP resolution.

import type {
  GameState,
  PlayerState,
  GameEvent,
  DamageKind,
  Color,
} from './types';
import { addLog, MAX_LIFE } from './state';
import { getCard } from './cards/registry';

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
  
  // M3: Apply damage modifiers.
  let finalAmount = amount;
  
  // §17.2.3: Apply shield damage reduction.
  for (const spell of target.maintainedSpells) {
    if (spell.behavior === 'shield') {
      const reduction = (spell.energy || 0) + 2;
      finalAmount = Math.max(0, finalAmount - reduction);
      addLog(state, target.id, `Shield reduces damage by ${reduction}`);
      // Consume the shield (remove it after use).
      const idx = target.maintainedSpells.indexOf(spell);
      if (idx !== -1) {
        target.maintainedSpells.splice(idx, 1);
        state.discard.push(spell.cardId);
      }
      break; // Only one shield can be active at a time.
    }
  }
  
  // Bloodshard: reduce damage by 1.
  if (hasModifier(state, target.id, 'bloodshard')) {
    finalAmount = Math.max(0, finalAmount - 1);
  }
  
  // Strength: double physical damage.
  if (kind === 'physical' && hasModifier(state, target.id, 'strength')) {
    finalAmount *= 2;
  }
  
  // Invisible: chance to dodge.
  if (hasModifier(state, target.id, 'invisible')) {
    const roll = state.rng.int(6) + 1;
    if (roll >= 3) {
      addLog(state, target.id, `${target.color} wizard dodges the attack!`);
      return { events, killed: false };
    }
  }
  
  if (finalAmount > 0) {
    target.life -= finalAmount;
    events.push({ type: 'damage', target: target.id, amount: finalAmount, kind });
    addLog(state, source ?? -1, `${target.color} wizard takes ${finalAmount} ${kind} damage (${target.life} life left)`);
  }

  // Pain Link: reflect damage back to source.
  if (source !== null && hasModifier(state, target.id, 'pain-link')) {
    const sourcePlayer = state.players.find((p) => p.id === source);
    if (sourcePlayer && sourcePlayer.alive) {
      events.push(...applyDamage(state, sourcePlayer, finalAmount, kind, target.id).events);
    }
  }

  if (target.life <= 0) {
    killWizard(state, target, source, events);
    return { events, killed: true };
  }
  return { events, killed: false };
}

// M3: Check if a player has a specific modifier.
export function hasModifier(state: GameState, playerId: number, modifier: string): boolean {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return false;
  
  // Check maintained spells for modifier behavior.
  for (const spell of player.maintainedSpells) {
    if (spell.behavior === 'modifier' && spell.meta?.type === modifier) {
      return true;
    }
  }
  
  // Check carried items for modifier behavior.
  for (const cardId of player.carriedItems) {
    const card = getCard(cardId);
    if (card && card.effect.op === 'apply-spell' && card.effect.modifier === modifier) {
      return true;
    }
  }
  
  return false;
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

  // M3: Resolve time-passes-damage spells.
  for (const spell of p.maintainedSpells) {
    if (spell.behavior === 'time-passes-damage' && spell.meta?.dmg) {
      const dmg = spell.meta.dmg as number;
      if (spell.target && spell.target.kind === 'wizard') {
        const targetId = (spell.target as { kind: 'wizard'; id: number }).id;
        const target = state.players.find((pl) => pl.id === targetId);
        if (target && target.alive) {
          events.push(...applyDamage(state, target, dmg, 'magical', p.id).events);
        }
      }
    }
  }

  // §17.2.4: Resolve transformation energy.
  if (p.transformed) {
    const card = getCard(p.transformed);
    if (card && card.duration === 'temporary') {
      // Store transformation energy in a meta field on the player.
      if (p.transformEnergy === undefined) {
        p.transformEnergy = card.energy ?? 1;
      }
      p.transformEnergy -= 1;
      if (p.transformEnergy <= 0) {
        addLog(state, p.id, `${p.color} wizard's transformation ends (energy depleted)`);
        p.transformed = null;
        p.transformEnergy = undefined;
      }
    }
  }

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

  // R8: Door re-locking - re-lock any door that was opened by this player
  // if they are no longer adjacent to it.
  relockDoorsForPlayer(state, p);

  return { events };
}

// R8: Re-lock doors opened by a player if they are no longer adjacent.
function relockDoorsForPlayer(state: GameState, p: PlayerState): void {
  const board = state.board;
  const pos = p.pos;
  const cell = board.sectors[pos.sector].grid[pos.r][pos.c];
  
  // Check all 4 sides for doors opened by this player.
  for (const side of ['N', 'S', 'E', 'W'] as const) {
    const door = cell.doors[side];
    if (door && door.heldOpenBy === p.id && !door.destroyed) {
      // Check if player is still adjacent to this door.
      const isAdjacent = isAdjacentToDoor(state, pos, side, p.id);
      if (!isAdjacent) {
        door.heldOpenBy = null;
        door.locked = true;
        addLog(state, p.id, `${p.color} wizard's door re-locks (no longer adjacent)`);
      }
    }
  }
}

// Check if a specific player is adjacent to a door on a specific side.
function isAdjacentToDoor(
  state: GameState,
  pos: { sector: string; r: number; c: number },
  side: 'N' | 'S' | 'E' | 'W',
  playerId: number,
): boolean {
  const board = state.board;
  const cell = board.sectors[pos.sector as Color].grid[pos.r][pos.c];
  const door = cell.doors[side];
  if (!door) return false;
  
  // Check if the specific player is at an adjacent position.
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return false;
  
  const adjacent = getAdjacentCells(pos);
  for (const adj of adjacent) {
    if (player.pos.sector === adj.sector && player.pos.r === adj.r && player.pos.c === adj.c) {
      return true;
    }
  }
  return false;
}

// Get adjacent cells to a position.
function getAdjacentCells(pos: { sector: string; r: number; c: number }): Array<{ sector: string; r: number; c: number }> {
  const result: Array<{ sector: string; r: number; c: number }> = [];
  const { sector, r, c } = pos;
  
  // North
  if (r > 0) result.push({ sector, r: r - 1, c });
  // South
  if (r < 4) result.push({ sector, r: r + 1, c });
  // West
  if (c > 0) result.push({ sector, r, c: c - 1 });
  // East
  if (c < 4) result.push({ sector, r, c: c + 1 });
  
  return result;
}

// R8: Consume energy card fuel.
// Energy card fuel consumption is handled in doCast (actions.ts).

// Apply damage to an object (wall/door). Returns cracks added.
// Shatter: double cracks on objects.
export function damageObject(
  obj: { cracks: number; destroyed: boolean },
  amount: number,
  hasShatter = false,
): number {
  if (obj.destroyed) return 0;
  const effectiveAmount = hasShatter ? amount * 2 : amount;
  const newCracks = Math.floor((obj.cracks + effectiveAmount) / 3) - Math.floor(obj.cracks / 3);
  obj.cracks += effectiveAmount;
  return newCracks;
}

// R5: Update treasure VP scoring.
// A player scores 1 VP for each enemy treasure in their home sector.
// Only emits events when scoring actually changes (avoids fake -1/+1 churn).
export function updateTreasureVP(state: GameState): GameEvent[] {
  const events: GameEvent[] = [];
  const { treasureHome, treasureScorer } = state;

  // Compute the new scoring state (which treasures should be scored by which players).
  const newScorer: Record<number, number> = {};
  for (const color of ['blue', 'red', 'yellow', 'green'] as const) {
    const sector = state.board.sectors[color];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        const cell = sector.grid[r][c];
        if (cell.kind !== 'home') continue;
        for (const treasureId of cell.treasures) {
          const homeColor = treasureHome[treasureId];
          // Only score if the treasure is not from this sector.
          if (homeColor && homeColor !== color) {
            // Find the player of this color.
            const player = state.players.find((p) => p.color === color && p.alive);
            if (player) {
              newScorer[treasureId] = player.id;
            }
          }
        }
      }
    }
  }

  // Compare with old scoring state and emit events only for differences.
  // 1. Revoke scoring that no longer applies (treasure moved, picked up, or scorer changed).
  for (const treasureIdStr of Object.keys(treasureScorer)) {
    const treasureId = parseInt(treasureIdStr, 10);
    const oldScorerId = treasureScorer[treasureId];
    const newScorerId = newScorer[treasureId];
    if (oldScorerId !== newScorerId) {
      const scorer = state.players.find((p) => p.id === oldScorerId);
      if (scorer) {
        scorer.vp -= 1;
        events.push({ type: 'vp', playerId: oldScorerId, amount: -1 });
      }
      delete treasureScorer[treasureId];
    }
  }

  // 2. Add new scoring (treasure dropped on home, or scorer changed).
  for (const treasureIdStr of Object.keys(newScorer)) {
    const treasureId = parseInt(treasureIdStr, 10);
    const newScorerId = newScorer[treasureId];
    if (treasureScorer[treasureId] !== newScorerId) {
      const player = state.players.find((p) => p.id === newScorerId);
      if (player) {
        player.vp += 1;
        treasureScorer[treasureId] = newScorerId;
        events.push({ type: 'vp', playerId: newScorerId, amount: 1 });
        addLog(state, newScorerId, `${player.color} wizard scores 1 VP for treasure in home`);
      }
    }
  }

  return events;
}