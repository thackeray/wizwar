// All player actions: validation + application. Single entry point.

import type { GameState, Action, Result, GameEvent, CellRef, TargetRef, Dir } from './types';
import { OPPOSITE } from './types';
import { addLog, currentPlayer, handSize, MAX_HAND_SIZE } from './state';
import { moveDestination, adjacentRefs, getCell, toGlobal, doorBetween, isConnectedByPortal } from './board';
import { canSee } from './los';
import { applyDamage, checkWin, updateTreasureVP, damageObject, hasModifier } from './damage';
import { endMoveCast, endTurn, isFirstTurn } from './turn';
import { resolveEffect } from './cards/effects';
import { getCard } from './cards/registry';
import { getPassives, getFuelEnergy, getDrawCount } from './passives';

export function applyAction(state: GameState, action: Action): Result {
  if (state.winner !== null) return { ok: false, reason: 'Game is over', events: [] };
  const p = currentPlayer(state);
  let result: Result;
  switch (action.type) {
    case 'move': result = doMove(state, p.id, action.dir); break;
    case 'punch': result = doPunch(state, p.id, action.target); break;
    case 'cast': result = doCast(state, p.id, action.cardId, action.target, action.energyCard); break;
    case 'resolve-cast': result = doResolveCast(state, p.id); break;
    case 'counter': result = doCounter(state, action.playerId, action.cardId); break;
    case 'use-item': result = doUseItem(state, p.id, action.cardId, action.target, action.fuel); break;
    case 'attack-object': result = doAttackObject(state, p.id, action.target, action.power); break;
    case 'pick-up-object': result = doPickUpObject(state, p.id, action.objectId); break;
    case 'drop-item': result = doDropItem(state, p.id, action.cardId); break;
    case 'pick-up-treasure': result = doPickUpTreasure(state, p.id, action.treasureId); break;
    case 'drop-treasure': result = doDropTreasure(state, p.id); break;
    case 'end-spell': result = doEndSpell(state, p.id, action.index); break;
    case 'discard': result = doDiscard(state, p.id, action.cardIds); break;
    case 'draw': result = doDraw(state, p.id, action.count); break;
    case 'boost-speed': result = doBoostSpeed(state, p.id, action.cardId); break;
    case 'end-turn': result = doEndTurn(state, p.id); break;
    default: return { ok: false, reason: 'Unknown action', events: [] };
  }
  // R5: Update treasure VP after any successful action.
  if (result.ok) {
    const vpEvents = updateTreasureVP(state);
    if (vpEvents.length > 0) {
      result.events.push(...vpEvents);
      checkWin(state, result.events);
    }
  }
  return result;
}

function notTurn(state: GameState, id: number): Result | null {
  return currentPlayer(state).id !== id ? { ok: false, reason: 'Not your turn', events: [] } : null;
}
function notMoveCast(state: GameState): Result | null {
  return state.phase !== 'move-cast' ? { ok: false, reason: 'Cannot act now', events: [] } : null;
}
// Stunned wizards can move (max 1 MP) or attack, but cannot cast/use items/pick up/boost.
function notStunnedForCast(state: GameState, id: number): Result | null {
  const p = state.players.find((pl) => pl.id === id)!;
  return p.stunned ? { ok: false, reason: 'Stunned', events: [] } : null;
}

// Helper: is this card an attack (for first-turn ban and attack counting)?
function isAttackCard(card: NonNullable<ReturnType<typeof getCard>>): boolean {
  return card.type === 'attack-spell' || card.countsAsAttack === true;
}

function doMove(state: GameState, id: number, dir: 'N' | 'S' | 'E' | 'W'): Result {
  const e = notTurn(state, id) ?? notMoveCast(state); if (e) return e;
  const p = currentPlayer(state);
  if (p.mp < 1) return { ok: false, reason: 'No MP left', events: [] };
  // Stunned wizards can move OR attack (choose one), not both.
  if (p.stunned && p.stunnedActionUsed === 'attack') {
    return { ok: false, reason: 'Stunned: already attacked', events: [] };
  }
  const dest = moveDestination(state.board, p.pos, dir, p.color);
  if (!dest) return { ok: false, reason: 'Cannot move that way', events: [] };
  
  // M5: Check for blocking objects in destination (only Stone Block blocks movement).
  const destCell = getCell(state.board, dest);
  const hasBlockingObject = destCell.objects.some((obj) => 
    obj.cardId === 'cantrip-stone-block'
  );
  if (hasBlockingObject) {
    return { ok: false, reason: 'Blocked by object', events: [] };
  }
  
  const from = p.pos;
  p.pos = dest; p.mp -= 1;
  // Stunned wizards: cap movement at 1 (consume remaining MP) and mark action used.
  if (p.stunned) {
    p.mp = 0;
    p.stunnedActionUsed = 'move';
  }
  // R3: Re-lock doors passed through if holder is no longer adjacent.
  relockDoorsPassed(state, from, dest);
  const events: GameEvent[] = [{ type: 'move', playerId: p.id, from, to: dest }];
  addLog(state, p.id, `${p.color} wizard moves`);
  
  // M5: Check for entry triggers (Booby Trap, Tacks).
  const entryEvents = checkEntryTriggers(state, p);
  events.push(...entryEvents);
  
  return { ok: true, events };
}

// M5: Check for entry triggers when a wizard enters a cell.
function checkEntryTriggers(state: GameState, p: GameState['players'][0]): GameEvent[] {
  const events: GameEvent[] = [];
  const cell = getCell(state.board, p.pos);
  
  for (const obj of cell.objects) {
    const card = getCard(obj.cardId);
    if (!card) continue;
    
    // Check for Booby Trap.
    if (obj.cardId === 'conjuring-booby-trap') {
      addLog(state, p.id, `Booby trap triggered!`);
      events.push(...applyDamage(state, p, 4, 'magical', null).events);
      // Remove the trap.
      cell.objects = cell.objects.filter((o) => o.id !== obj.id);
      break;
    }
    
    // Check for Handful of Tacks.
    if (obj.cardId === 'conjuring-handful-of-tacks') {
      addLog(state, p.id, `Tacks triggered!`);
      events.push(...applyDamage(state, p, 3, 'physical', null).events);
      // Tacks remain in place.
      break;
    }
  }
  
  return events;
}

// R3: After moving, re-lock any door between from and to if the holder
// is no longer adjacent to it.
function relockDoorsPassed(
  state: GameState,
  from: CellRef,
  to: CellRef,
): void {
  const board = state.board;
  // Determine the direction of movement.
  const g1 = toGlobal(from);
  const g2 = toGlobal(to);
  const dr = g2.row - g1.row;
  const dc = g2.col - g1.col;
  let dir: Dir | null = null;
  if (dr === -1) dir = 'N';
  else if (dr === 1) dir = 'S';
  else if (dc === 1) dir = 'E';
  else if (dc === -1) dir = 'W';
  if (!dir) return;

  // Check for a door on either side of the boundary.
  const door1 = doorBetween(board, from, dir);
  const door2 = doorBetween(board, to, OPPOSITE[dir]);
  const door = door1 ?? door2;
  if (!door || door.destroyed) return;

  // If the door is held open by someone, check if they're still adjacent.
  if (door.heldOpenBy !== null) {
    const holder = state.players.find((pl) => pl.id === door.heldOpenBy);
    if (holder && holder.alive) {
      // Check if holder is adjacent to the door (either cell).
      const adjFrom = adjacentRefs(from).some(
        (r) => r.sector === holder.pos.sector && r.r === holder.pos.r && r.c === holder.pos.c,
      );
      const adjTo = adjacentRefs(to).some(
        (r) => r.sector === holder.pos.sector && r.r === holder.pos.r && r.c === holder.pos.c,
      );
      if (adjFrom || adjTo) return; // Holder still adjacent, keep open.
    }
  }

  // Re-lock the door.
  door.locked = true;
  door.heldOpenBy = null;
}

function doPunch(state: GameState, id: number, target: number): Result {
  const e = notTurn(state, id) ?? notMoveCast(state); if (e) return e;
  const p = currentPlayer(state);
  // Adrenaline allows 2 attacks per turn.
  const maxAttacks = hasModifier(state, p.id, 'adrenaline') ? 2 : 1;
  if (p.attacksUsed >= maxAttacks) {
    return { ok: false, reason: 'Already attacked', events: [] };
  }
  if (isFirstTurn(state)) return { ok: false, reason: 'No attacks on first turn', events: [] };
  // Stunned wizards can move OR attack (choose one), not both.
  if (p.stunned && p.stunnedActionUsed === 'move') {
    return { ok: false, reason: 'Stunned: already moved', events: [] };
  }
  const t = state.players.find((pl) => pl.id === target);
  if (!t || !t.alive) return { ok: false, reason: 'Invalid target', events: [] };
  if (!isAdjacent(state, p.pos, t.pos)) return { ok: false, reason: 'Target not adjacent', events: [] };
  p.attacked = true;
  p.attacksUsed++;
  // Mark stunned action as used for attack.
  if (p.stunned) p.stunnedActionUsed = 'attack';
  const events: GameEvent[] = [];
  addLog(state, p.id, `${p.color} wizard punches ${t.color} wizard`);
  
  // M5: Apply Mightstone passive.
  let damage = 1;
  const passives = getPassives(state, p.id);
  if (passives.mightstone) {
    // §17.2.2: Use state.rng for deterministic dice rolls.
    const dieRoll = state.rng.int(6) + 1;
    damage += dieRoll;
    addLog(state, p.id, `Mightstone: +${dieRoll} damage`);
  }
  
  // Fire Cloak: +2 fire damage to punches.
  if (hasModifier(state, p.id, 'fire-cloak')) {
    damage += 2;
    addLog(state, p.id, `Fire Cloak: +2 fire damage`);
  }
  
  events.push(...applyDamage(state, t, damage, 'physical', p.id).events);
  checkWin(state, events);
  return { ok: true, events };
}

function isAdjacent(state: GameState, a: CellRef, b: CellRef): boolean {
  // Check normal adjacency.
  if (adjacentRefs(a).some((r) => r.sector === b.sector && r.r === b.r && r.c === b.c)) {
    return true;
  }
  // Check portal adjacency (both sides of a portal are adjacent).
  return isConnectedByPortal(state.board, a, b);
}

function doCast(state: GameState, id: number, cardId: string, target?: TargetRef, energyCard?: string): Result {
  const e = notTurn(state, id) ?? notMoveCast(state) ?? notStunnedForCast(state, id); if (e) return e;
  const p = currentPlayer(state);
  const card = getCard(cardId);
  if (!card) return { ok: false, reason: 'Unknown card', events: [] };
  if (!p.hand.includes(cardId)) return { ok: false, reason: 'Card not in hand', events: [] };
  // R2: First turn attack ban for attack spells.
  if (isFirstTurn(state) && isAttackCard(card)) {
    return { ok: false, reason: 'No attacks on first turn', events: [] };
  }
  // §14.4: Attack count limit - can only attack once per turn (2 with Adrenaline).
  if (isAttackCard(card)) {
    const maxAttacks = hasModifier(state, p.id, 'adrenaline') ? 2 : 1;
    if (p.attacksUsed >= maxAttacks) {
      return { ok: false, reason: 'Already attacked this turn', events: [] };
    }
  }
  if (target) {
    const v = validateTarget(state, p, card, target);
    if (!v.ok) return v;
  }
  
  // §16.1.4: Validate energy card BEFORE consuming any cards.
  const hasAdd = hasModifier(state, p.id, 'add');
  let secondEnergyCardId: string | null = null;
  if (energyCard) {
    const ec = getCard(energyCard);
    if (!ec || ec.energyValue <= 0) return { ok: false, reason: 'Invalid energy card', events: [] };
    // Check if energy card is in hand.
    if (!p.hand.includes(energyCard)) return { ok: false, reason: 'Energy card not in hand', events: [] };
    
    // Add: if we have Add, find a second energy card to combine.
    if (hasAdd) {
      secondEnergyCardId = p.hand.find((c) => {
        const card = getCard(c);
        return card && card.energyValue > 0 && c !== energyCard;
      }) ?? null;
    }
  }
  
  // All validations passed, now consume cards.
  p.hand = p.hand.filter((c) => c !== cardId);
  let energy = card.energy;
  if (energyCard) {
    const ec = getCard(energyCard)!;
    // Consume the energy card as fuel.
    p.hand = p.hand.filter((c) => c !== energyCard);
    state.discard.push(energyCard);
    // Use the energy card's value as the energy for this cast.
    energy = ec.energyValue;
    // M5: Apply Powerstone passive.
    energy = getFuelEnergy(state, p.id, energy);
    addLog(state, p.id, `${p.color} wizard uses ${ec.name} as fuel (${energy} energy)`);
    
    // Add: consume the second energy card if found.
    if (secondEnergyCardId) {
      const secEc = getCard(secondEnergyCardId)!;
      p.hand = p.hand.filter((c) => c !== secondEnergyCardId);
      state.discard.push(secondEnergyCardId);
      energy += secEc.energyValue;
      addLog(state, p.id, `${p.color} wizard uses Add to combine energy (+${secEc.energyValue})`);
    }
  }
  
  // M1: Set up the awaiting cast state (don't resolve yet).
  const counterOrder = calculateCounterOrder(state, p.id);
  state.awaitingCast = {
    caster: p.id,
    cardId,
    target: target ?? null,
    energy,
    energyCard: energyCard ?? null,
    counterOrder,
    countered: false,
  };
  
  const events: GameEvent[] = [
    { type: 'cast', playerId: p.id, cardId },
    { type: 'awaiting-counter', playerId: p.id },
  ];
  addLog(state, p.id, `${p.color} wizard casts ${card.name}`);
  return { ok: true, events };
}

// M1: Calculate the counter order (players who can counter, in order).
function calculateCounterOrder(state: GameState, casterId: number): number[] {
  const order: number[] = [];
  const n = state.players.length;
  const casterIdx = state.players.findIndex((p) => p.id === casterId);
  
  // Start from the next player after the caster.
  for (let i = 1; i < n; i++) {
    const idx = (casterIdx + i) % n;
    const player = state.players[idx];
    if (player.alive && player.id !== casterId) {
      order.push(player.id);
    }
  }
  
  return order;
}

// M1: Resolve the cast (after counter window).
function doResolveCast(state: GameState, id: number): Result {
  const e = notTurn(state, id); if (e) return e;
  const p = currentPlayer(state);
  
  if (!state.awaitingCast) {
    return { ok: false, reason: 'No cast to resolve', events: [] };
  }
  
  const { cardId, target, energy, countered } = state.awaitingCast;
  const card = getCard(cardId);
  if (!card) {
    state.awaitingCast = null;
    return { ok: false, reason: 'Unknown card', events: [] };
  }
  
  // If countered, the spell is void.
  if (countered) {
    state.discard.push(cardId);
    state.awaitingCast = null;
    addLog(state, p.id, `${p.color} wizard's spell was countered`);
    return { ok: true, events: [] };
  }
  
  // Set attacked flag for attack spells.
  if (isAttackCard(card)) {
    p.attacked = true;
    p.attacksUsed++;
  }
  
  // Resolve the effect.
  const events: GameEvent[] = [];
  events.push(...resolveEffect(state, p, card, target, energy).events);
  checkWin(state, events);
  
  state.discard.push(cardId);
  state.awaitingCast = null;
  return { ok: true, events };
}

// M1: Counter a spell.
function doCounter(state: GameState, id: number, cardId: string): Result {
  const p = state.players.find((pl) => pl.id === id);
  if (!p || !p.alive) {
    return { ok: false, reason: 'Invalid counter player', events: [] };
  }
  
  if (!state.awaitingCast) {
    return { ok: false, reason: 'No cast to counter', events: [] };
  }
  
  const { caster, countered, counterOrder, cardId: castCardId } = state.awaitingCast;
  if (id === caster) {
    return { ok: false, reason: 'Cannot counter own spell', events: [] };
  }
  if (countered) {
    return { ok: false, reason: 'Already countered', events: [] };
  }
  if (!counterOrder.includes(id)) {
    return { ok: false, reason: 'Not in counter order', events: [] };
  }
  
  // Check if the card is in hand or carried items (for Null Powder).
  const inHand = p.hand.includes(cardId);
  const inCarried = p.carriedItems.includes(cardId);
  if (!inHand && !inCarried) {
    return { ok: false, reason: 'Card not in hand or carried', events: [] };
  }
  
  // Validate the counter card matches the spell being countered.
  const counterCard = getCard(cardId);
  const castCard = getCard(castCardId);
  if (!counterCard || !castCard) {
    return { ok: false, reason: 'Invalid card', events: [] };
  }
  
  // Check counter.blocks includes the cast card's type.
  if (counterCard.counter) {
    if (!counterCard.counter.blocks.includes(castCard.type)) {
      return { ok: false, reason: 'Counter does not block this spell type', events: [] };
    }
    // Check requiresTargetingMe.
    if (counterCard.counter.requiresTargetingMe) {
      const target = state.awaitingCast.target;
      if (!target || target.kind !== 'wizard' || target.id !== id) {
        return { ok: false, reason: 'Counter requires spell targeting you', events: [] };
      }
    }
  } else {
    // No counter declaration - cannot counter.
    return { ok: false, reason: 'Card cannot counter', events: [] };
  }
  
  // Consume the counter card (from hand or carried items).
  if (p.hand.includes(cardId)) {
    p.hand = p.hand.filter((c) => c !== cardId);
  } else if (p.carriedItems.includes(cardId)) {
    p.carriedItems = p.carriedItems.filter((c) => c !== cardId);
  }
  state.discard.push(cardId);

  // §15.2: the countered spell card was already removed from the caster's hand
  // in doCast; it must go to the discard pile so it re-enters the deck economy.
  state.discard.push(castCardId);

  // Mark the cast as countered and clear awaitingCast.
  state.awaitingCast.countered = true;
  state.awaitingCast = null;
  
  const events: GameEvent[] = [
    { type: 'counter', playerId: p.id, cardId },
  ];
  addLog(state, p.id, `${p.color} wizard counters with ${counterCard.name}`);
  
  return { ok: true, events };
}

function validateTarget(state: GameState, p: GameState['players'][0], card: NonNullable<ReturnType<typeof getCard>>, target: TargetRef): Result {
  // M2: Comprehensive target validation for all types.
  
  // 1. Check target exists.
  if (target.kind === 'wizard') {
    const t = state.players.find((pl) => pl.id === target.id);
    if (!t || !t.alive) return { ok: false, reason: 'Target not found or dead', events: [] };
  }
  
  // 2. Check target is in range.
  if (card.range === 'adjacent') {
    if (target.kind === 'wizard') {
      const t = state.players.find((pl) => pl.id === target.id)!;
      if (!isAdjacent(state, p.pos, t.pos)) return { ok: false, reason: 'Target not adjacent', events: [] };
    } else if (target.kind === 'cell') {
      if (!isAdjacent(state, p.pos, target.ref)) return { ok: false, reason: 'Target not adjacent', events: [] };
    } else if (target.kind === 'door' || target.kind === 'wall') {
      // Check if the door/wall is adjacent.
      const ref = target.ref;
      if (!isAdjacent(state, p.pos, { sector: ref.sector, r: ref.r, c: ref.c })) {
        return { ok: false, reason: 'Target not adjacent', events: [] };
      }
    }
  } else if (card.range === 'los') {
    // 3. Check target is visible (LOS) - use canSee for Visionstone/Around the Corner support.
    if (target.kind === 'wizard') {
      const t = state.players.find((pl) => pl.id === target.id)!;
      if (!canSee(state, p.id, p.pos, t.pos)) return { ok: false, reason: 'No line of sight', events: [] };
    } else if (target.kind === 'cell') {
      if (!canSee(state, p.id, p.pos, target.ref)) return { ok: false, reason: 'No line of sight', events: [] };
    } else if (target.kind === 'door' || target.kind === 'wall') {
      // Check if the door/wall is visible.
      const ref = target.ref;
      if (!canSee(state, p.id, p.pos, { sector: ref.sector, r: ref.r, c: ref.c })) {
        return { ok: false, reason: 'No line of sight', events: [] };
      }
    }
  } else if (card.range === 'same-sector') {
    // 4. Check target is in the same sector.
    if (target.kind === 'wizard') {
      const t = state.players.find((pl) => pl.id === target.id)!;
      if (t.pos.sector !== p.pos.sector) return { ok: false, reason: 'Target not in same sector', events: [] };
    } else if (target.kind === 'cell') {
      if (target.ref.sector !== p.pos.sector) return { ok: false, reason: 'Target not in same sector', events: [] };
    }
  }
  // 'anywhere' and 'caster' ranges don't need additional checks.
  
  return { ok: true, events: [] };
}

function doUseItem(state: GameState, id: number, cardId: string, target?: TargetRef, fuel?: string): Result {
  const e = notTurn(state, id) ?? notMoveCast(state) ?? notStunnedForCast(state, id); if (e) return e;
  const p = currentPlayer(state);
  const card = getCard(cardId);
  if (!card) return { ok: false, reason: 'Unknown card', events: [] };
  if (!p.carriedItems.includes(cardId)) return { ok: false, reason: 'Item not carried', events: [] };
  // R2: First turn attack ban for attack items.
  if (isFirstTurn(state) && isAttackCard(card)) {
    return { ok: false, reason: 'No attacks on first turn', events: [] };
  }
  // Attack count limit for attack items.
  if (isAttackCard(card)) {
    const maxAttacks = hasModifier(state, p.id, 'adrenaline') ? 2 : 1;
    if (p.attacksUsed >= maxAttacks) {
      return { ok: false, reason: 'Already attacked this turn', events: [] };
    }
  }
  
  // §16.1.4: Validate fuel BEFORE consuming any items.
  if (fuel) {
    const fuelCard = getCard(fuel);
    if (!fuelCard || !p.hand.includes(fuel)) {
      return { ok: false, reason: 'Invalid fuel card', events: [] };
    }
  }
  
  // All validations passed, now consume items.
  p.carriedItems = p.carriedItems.filter((c) => c !== cardId);
  const events: GameEvent[] = [];
  addLog(state, p.id, `${p.color} wizard uses ${card.name}`);
  if (isAttackCard(card)) {
    p.attacked = true;
    p.attacksUsed++;
  }
  
  // M5: Handle fuel for Wizardblade
  let energy = card.energy;
  if (fuel) {
    const fuelCard = getCard(fuel)!;
    p.hand = p.hand.filter((c) => c !== fuel);
    state.discard.push(fuel);
    energy = fuelCard.energyValue;
    addLog(state, p.id, `${p.color} wizard uses ${fuelCard.name} as fuel (${energy} energy)`);
  }
  
  // §16.3: Implement item card effects.
  const itemEffect = resolveItemEffect(state, p, cardId, target, energy);
  events.push(...itemEffect.events);
  
  checkWin(state, events);
  return { ok: true, events };
}

// §16.3: Resolve item card effects.
// §17.2.6: Use prefix matching to handle variant cards.
function resolveItemEffect(
  state: GameState,
  p: GameState['players'][0],
  cardId: string,
  target: TargetRef | undefined,
  energy: number,
): { events: GameEvent[] } {
  const events: GameEvent[] = [];
  
  // Throwing items (attack, consume).
  // §18.3: Can hit wizards, objects, and creatures.
  if (cardId.startsWith('alchemy-boomstone')) {
    // Boomstone: 4 magical fire damage.
    if (target && target.kind === 'wizard') {
      const t = state.players.find((pl) => pl.id === target.id)!;
      events.push(...applyDamage(state, t, 4, 'magical', p.id).events);
      addLog(state, p.id, `Boomstone explodes for 4 magical fire damage!`);
    } else if (target && target.kind === 'object') {
      const objId = target.id;
      for (const sector of Object.values(state.board.sectors)) {
        for (const row of sector.grid) {
          for (const cell of row) {
            const obj = cell.objects.find((o) => o.id === objId);
            if (obj) {
              obj.cracks += 4;
              if (obj.cracks >= 3) obj.destroyed = true;
              addLog(state, p.id, `Boomstone hits the object!`);
              break;
            }
          }
        }
      }
    }
  } else if (cardId === 'cantrip-large-rock') {
    // Large Rock: 3 physical damage.
    if (target && target.kind === 'wizard') {
      const t = state.players.find((pl) => pl.id === target.id)!;
      events.push(...applyDamage(state, t, 3, 'physical', p.id).events);
      addLog(state, p.id, `Large Rock hits for 3 physical damage!`);
    } else if (target && target.kind === 'object') {
      const objId = target.id;
      for (const sector of Object.values(state.board.sectors)) {
        for (const row of sector.grid) {
          for (const cell of row) {
            const obj = cell.objects.find((o) => o.id === objId);
            if (obj) {
              obj.cracks += 3;
              if (obj.cracks >= 3) obj.destroyed = true;
              addLog(state, p.id, `Large Rock hits the object!`);
              break;
            }
          }
        }
      }
    }
  } else if (cardId === 'elemental-stone-spikes') {
    // Stone Spikes: 2+ physical damage.
    if (target && target.kind === 'wizard') {
      const t = state.players.find((pl) => pl.id === target.id)!;
      const dmg = 2 + state.rng.int(3); // 2-4 damage
      events.push(...applyDamage(state, t, dmg, 'physical', p.id).events);
      addLog(state, p.id, `Stone Spikes hit for ${dmg} physical damage!`);
    } else if (target && target.kind === 'object') {
      const objId = target.id;
      const dmg = 2 + state.rng.int(3);
      for (const sector of Object.values(state.board.sectors)) {
        for (const row of sector.grid) {
          for (const cell of row) {
            const obj = cell.objects.find((o) => o.id === objId);
            if (obj) {
              obj.cracks += dmg;
              if (obj.cracks >= 3) obj.destroyed = true;
              addLog(state, p.id, `Stone Spikes hit the object for ${dmg}!`);
              break;
            }
          }
        }
      }
    }
  } else if (cardId.startsWith('alchemy-universal-solvent')) {
    // Universal Solvent: Destroy target object, wall, or door.
    // §18.3: Can dissolve walls and doors per card text.
    if (target && target.kind === 'object') {
      const objId = target.id;
      for (const sector of Object.values(state.board.sectors)) {
        for (const row of sector.grid) {
          for (const cell of row) {
            const obj = cell.objects.find((o) => o.id === objId);
            if (obj) {
              obj.destroyed = true;
              addLog(state, p.id, `Universal Solvent destroys the object!`);
              break;
            }
          }
        }
      }
    } else if (target && target.kind === 'wall') {
      // Dissolve a wall.
      const ref = target.ref;
      const cell = getCell(state.board, { sector: ref.sector, r: ref.r, c: ref.c });
      cell.walls[ref.side] = false;
      addLog(state, p.id, `Universal Solvent dissolves the wall!`);
    } else if (target && target.kind === 'door') {
      // Dissolve a door.
      const ref = target.ref;
      const cell = getCell(state.board, { sector: ref.sector, r: ref.r, c: ref.c });
      const door = cell.doors[ref.side];
      if (door) {
        door.destroyed = true;
        addLog(state, p.id, `Universal Solvent dissolves the door!`);
      }
    }
  } else if (cardId === 'thaumaturgy-wizardblade') {
    // Wizardblade: Damage = fuel energy.
    if (target && target.kind === 'wizard') {
      const t = state.players.find((pl) => pl.id === target.id)!;
      events.push(...applyDamage(state, t, energy, 'magical', p.id).events);
      addLog(state, p.id, `Wizardblade strikes for ${energy} magical damage!`);
    }
  } else if (cardId === 'thaumaturgy-master-key') {
    // Master Key: Open door.
    if (target && target.kind === 'door') {
      const ref = target.ref;
      const cell = getCell(state.board, { sector: ref.sector, r: ref.r, c: ref.c });
      const door = cell.doors[ref.side];
      if (door && !door.destroyed) {
        door.locked = false;
        door.heldOpenBy = p.id;
        addLog(state, p.id, `Master Key opens the door!`);
      }
    }
  } else if (cardId === 'conjuring-booby-trap') {
    // Booby Trap: Place trap that deals 4 damage on entry.
    if (target && target.kind === 'cell') {
      const cell = getCell(state.board, target.ref);
      cell.objects.push({
        cardId: 'conjuring-booby-trap',
        id: state.nextObjectId++,
        owner: p.id,
        cracks: 1,
        destroyed: false,
      });
      addLog(state, p.id, `Booby Trap placed!`);
    }
  } else if (cardId === 'conjuring-handful-of-tacks') {
    // Handful of Tacks: Place tacks that deal 3 damage on entry.
    if (target && target.kind === 'cell') {
      const cell = getCell(state.board, target.ref);
      cell.objects.push({
        cardId: 'conjuring-handful-of-tacks',
        id: state.nextObjectId++,
        owner: p.id,
        cracks: 1,
        destroyed: false,
      });
      addLog(state, p.id, `Handful of Tacks placed!`);
    }
  } else if (cardId === 'conjuring-dust-cloud') {
    // Dust Cloud: Block LOS.
    if (target && target.kind === 'cell') {
      const cell = getCell(state.board, target.ref);
      cell.objects.push({
        cardId: 'conjuring-dust-cloud',
        id: state.nextObjectId++,
        owner: p.id,
        cracks: 1,
        destroyed: false,
      });
      addLog(state, p.id, `Dust Cloud created!`);
    }
  } else if (cardId.startsWith('conjuring-thornbush') || cardId.startsWith('conjuring-rosebush')) {
    // Thornbush/Rosebush: Block, 1 crack to destroy.
    if (target && target.kind === 'cell') {
      const cell = getCell(state.board, target.ref);
      cell.objects.push({
        cardId: cardId,
        id: state.nextObjectId++,
        owner: p.id,
        cracks: 1,
        destroyed: false,
      });
      addLog(state, p.id, `${cardId.startsWith('conjuring-thornbush') ? 'Thornbush' : 'Rosebush'} planted!`);
    }
  } else if (cardId === 'elemental-stone-block') {
    // Stone Block: Block movement.
    if (target && target.kind === 'cell') {
      const cell = getCell(state.board, target.ref);
      cell.objects.push({
        cardId: 'elemental-stone-block',
        id: state.nextObjectId++,
        owner: p.id,
        cracks: 5,
        destroyed: false,
      });
      addLog(state, p.id, `Stone Block placed!`);
    }
  }
  
  return { events };
}

// R6: Attack a wall, door, or object.
function doAttackObject(
  state: GameState,
  id: number,
  target: TargetRef,
  power?: number,
): Result {
  const e = notTurn(state, id) ?? notMoveCast(state); if (e) return e;
  const p = currentPlayer(state);
  const maxAttacks = hasModifier(state, p.id, 'adrenaline') ? 2 : 1;
  if (p.attacksUsed >= maxAttacks) return { ok: false, reason: 'Already attacked', events: [] };
  if (isFirstTurn(state)) return { ok: false, reason: 'No attacks on first turn', events: [] };

  const dmg = power ?? 1;
  const events: GameEvent[] = [];

  const hasShatter = hasModifier(state, p.id, 'shatter');
  if (target.kind === 'wall') {
    const ref = target.ref;
    const cell = getCell(state.board, { sector: ref.sector, r: ref.r, c: ref.c });
    
    // §16.2.1: Support both dynamic and static walls.
    const dw = cell.dynamicWalls[ref.side];
    if (dw) {
      // Dynamic wall - use existing logic.
      const cracks = damageObject(dw, dmg, hasShatter);
      if (cracks > 0) {
        const crackCount = Math.floor(dw.cracks / 3);
        addLog(state, p.id, `${p.color} wizard attacks wall (${crackCount} cracks)`);
        // §16.2.2: Wall destroyed at 5 cracks (15 damage).
        if (crackCount >= 5) {
          dw.destroyed = true;
          addLog(state, p.id, `Wall destroyed!`);
        }
      }
    } else if (cell.walls[ref.side]) {
      // Static wall - track cracks separately.
      if (!cell.wallCracks) cell.wallCracks = {};
      const currentDamage = cell.wallCracks[ref.side] ?? 0;
      const newDamage = currentDamage + dmg * (hasShatter ? 2 : 1);
      cell.wallCracks[ref.side] = newDamage;
      const crackCount = Math.floor(newDamage / 3);
      addLog(state, p.id, `${p.color} wizard attacks static wall (${crackCount} cracks)`);
      // §16.2.2: Static wall destroyed at 5 cracks (15 damage).
      if (crackCount >= 5) {
        cell.walls[ref.side] = false;
        addLog(state, p.id, `Static wall destroyed!`);
      }
    } else {
      return { ok: false, reason: 'No wall there', events: [] };
    }
  } else if (target.kind === 'door') {
    const ref = target.ref;
    const cell = getCell(state.board, { sector: ref.sector, r: ref.r, c: ref.c });
    const door = cell.doors[ref.side];
    if (!door) return { ok: false, reason: 'No door there', events: [] };
    const cracks = damageObject(door, dmg, hasShatter);
    if (cracks > 0) {
      const crackCount = Math.floor(door.cracks / 3);
      addLog(state, p.id, `${p.color} wizard attacks door (${crackCount} cracks)`);
      // §16.2.2: Door destroyed at 3 cracks (9 damage).
      if (crackCount >= 3) {
        door.destroyed = true;
        addLog(state, p.id, `Door destroyed!`);
      }
    }
  } else if (target.kind === 'object') {
    // M5: Attack objects (thornbush, rosebush, etc.)
    const objId = target.id;
    let found = false;
    for (const sector of Object.values(state.board.sectors)) {
      for (const row of sector.grid) {
        for (const cell of row) {
          const obj = cell.objects.find((o) => o.id === objId);
          if (obj) {
            found = true;
            // Initialize cracks if not set.
            if (obj.cracks === undefined) obj.cracks = 0;
            if (obj.destroyed) {
              addLog(state, p.id, `Object already destroyed`);
              break;
            }
            obj.cracks += dmg;
            addLog(state, p.id, `${p.color} wizard attacks object (${obj.cracks} cracks)`);
            // Thornbush and Rosebush take 1 crack to destroy.
            const card = getCard(obj.cardId);
            if (card && (obj.cardId.includes('thornbush') || obj.cardId.includes('rosebush'))) {
              if (obj.cracks >= 1) {
                obj.destroyed = true;
                cell.objects = cell.objects.filter((o) => o.id !== obj.id);
                addLog(state, p.id, `Object destroyed!`);
              }
            }
            break;
          }
        }
      }
      if (found) break;
    }
    if (!found) {
      return { ok: false, reason: 'Object not found', events: [] };
    }
  } else {
    return { ok: false, reason: 'Invalid target type', events: [] };
  }

  p.attacked = true;
  p.attacksUsed++;
  return { ok: true, events };
}

function doPickUpObject(state: GameState, id: number, objectId: number): Result {
  const e = notTurn(state, id) ?? notMoveCast(state) ?? notStunnedForCast(state, id); if (e) return e;
  const p = currentPlayer(state);
  if (p.mp < 1) return { ok: false, reason: 'No MP left', events: [] };
  const cell = getCell(state.board, p.pos);
  const idx = cell.objects.findIndex((o) => o.id === objectId);
  if (idx === -1) return { ok: false, reason: 'Object not here', events: [] };
  const hasExtraArms = hasModifier(state, p.id, 'extra-arms');
  if (handSize(p, hasExtraArms) >= MAX_HAND_SIZE) return { ok: false, reason: 'Hand full', events: [] };
  const obj = cell.objects.splice(idx, 1)[0];
  p.carriedItems.push(obj.cardId); p.mp -= 1;
  addLog(state, p.id, `${p.color} wizard picks up an object`);
  return { ok: true, events: [] };
}

function doDropItem(state: GameState, id: number, cardId: string): Result {
  const e = notTurn(state, id) ?? notMoveCast(state); if (e) return e;
  const p = currentPlayer(state);
  if (!p.carriedItems.includes(cardId)) return { ok: false, reason: 'Item not carried', events: [] };
  p.carriedItems = p.carriedItems.filter((c) => c !== cardId);
  getCell(state.board, p.pos).objects.push({ cardId, id: state.nextObjectId++, owner: p.id });
  addLog(state, p.id, `${p.color} wizard drops an item`);
  return { ok: true, events: [] };
}

function doPickUpTreasure(state: GameState, id: number, treasureId: number): Result {
  const e = notTurn(state, id) ?? notMoveCast(state); if (e) return e;
  const p = currentPlayer(state);
  const cell = getCell(state.board, p.pos);
  const idx = cell.treasures.indexOf(treasureId);
  if (idx === -1) return { ok: false, reason: 'Treasure not here', events: [] };
  if (p.carriedTreasure !== null) return { ok: false, reason: 'Already carrying treasure', events: [] };
  cell.treasures.splice(idx, 1);
  p.carriedTreasure = treasureId;
  addLog(state, p.id, `${p.color} wizard picks up treasure`);
  
  // Fool's Gold: trigger damage if enemy picks up treasure in caster's home sector.
  const events: GameEvent[] = [];
  for (const other of state.players) {
    if (other.id === p.id || !other.alive) continue;
    if (hasModifier(state, other.id, 'fools-gold')) {
      // §17.2.5: Check if the picker is in the caster's home sector.
      if (p.pos.sector === other.color) {
        addLog(state, other.id, `Fool's Gold triggered!`);
        events.push(...applyDamage(state, p, 3, 'magical', other.id).events);
      }
    }
  }
  
  endMoveCast(state);
  return { ok: true, events };
}

function doDropTreasure(state: GameState, id: number): Result {
  const e = notTurn(state, id) ?? notMoveCast(state); if (e) return e;
  const p = currentPlayer(state);
  if (p.carriedTreasure === null) return { ok: false, reason: 'Not carrying treasure', events: [] };
  getCell(state.board, p.pos).treasures.push(p.carriedTreasure);
  p.carriedTreasure = null;
  addLog(state, p.id, `${p.color} wizard drops treasure`);
  endMoveCast(state);
  return { ok: true, events: [] };
}

function doEndSpell(state: GameState, id: number, index: number): Result {
  const e = notTurn(state, id) ?? notMoveCast(state); if (e) return e;
  const p = currentPlayer(state);
  if (index < 0 || index >= p.maintainedSpells.length) return { ok: false, reason: 'Invalid spell index', events: [] };
  const spell = p.maintainedSpells.splice(index, 1)[0];
  state.discard.push(spell.cardId);
  addLog(state, p.id, `${p.color} wizard ends a spell`);
  return { ok: true, events: [] };
}

function doDiscard(state: GameState, id: number, cardIds: string[]): Result {
  const e = notTurn(state, id); if (e) return e;
  const p = currentPlayer(state);
  if (state.phase !== 'discard-draw') return { ok: false, reason: 'Cannot discard now', events: [] };
  for (const c of cardIds) if (!p.hand.includes(c)) return { ok: false, reason: 'Card not in hand', events: [] };
  for (const c of cardIds) { p.hand = p.hand.filter((x) => x !== c); state.discard.push(c); }
  addLog(state, p.id, `${p.color} wizard discards ${cardIds.length} cards`);
  return { ok: true, events: [{ type: 'discard', playerId: p.id, cardIds }] };
}

function doDraw(state: GameState, id: number, count: number): Result {
  const e = notTurn(state, id); if (e) return e;
  const p = currentPlayer(state);
  if (state.phase !== 'discard-draw') return { ok: false, reason: 'Cannot draw now', events: [] };
  // §16.2.5: Use getDrawCount to support Spellstone passive.
  const maxDraw = getDrawCount(state, p.id, 2);
  if (count > maxDraw) return { ok: false, reason: `Can only draw up to ${maxDraw}`, events: [] };
  let drawn = 0;
  const hasExtraArms = hasModifier(state, p.id, 'extra-arms');
  for (let i = 0; i < count; i++) {
    if (handSize(p, hasExtraArms) >= MAX_HAND_SIZE) break;
    if (state.deck.length === 0) {
      if (state.discard.length === 0) break;
      state.deck = state.rng.shuffle(state.discard);
      state.discard = [];
    }
    const c = state.deck.pop();
    if (c) { p.hand.push(c); drawn++; }
  }
  if (drawn > 0) addLog(state, p.id, `${p.color} wizard draws ${drawn} cards`);
  return { ok: true, events: drawn > 0 ? [{ type: 'draw', playerId: p.id, count: drawn }] : [] };
}

function doBoostSpeed(state: GameState, id: number, cardId: string): Result {
  const e = notTurn(state, id) ?? notMoveCast(state) ?? notStunnedForCast(state, id); if (e) return e;
  const p = currentPlayer(state);
  if (p.speedBoosted) return { ok: false, reason: 'Already boosted', events: [] };
  const card = getCard(cardId);
  if (!card || card.energyValue <= 0) return { ok: false, reason: 'Invalid energy card', events: [] };
  if (!p.hand.includes(cardId)) return { ok: false, reason: 'Card not in hand', events: [] };
  p.hand = p.hand.filter((c) => c !== cardId);
  state.discard.push(cardId);
  p.mp += card.energyValue; p.speedBoosted = true;
  addLog(state, p.id, `${p.color} wizard boosts speed by ${card.energyValue}`);
  return { ok: true, events: [] };
}

function doEndTurn(state: GameState, id: number): Result {
  const e = notTurn(state, id); if (e) return e;
  if (state.phase === 'move-cast') {
    // Finish Move & Cast -> enter Discard & Draw (do not advance yet).
    return endMoveCast(state);
  }
  if (state.phase === 'discard-draw') {
    // Finish Discard & Draw -> advance to the next player.
    return endTurn(state);
  }
  return { ok: false, reason: 'Cannot end turn now', events: [] };
}