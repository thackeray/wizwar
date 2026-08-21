// All player actions: validation + application. Single entry point.

import type { GameState, Action, Result, GameEvent, CellRef, TargetRef } from './types';
import { addLog, currentPlayer, handSize, MAX_HAND_SIZE } from './state';
import { moveDestination, hasLOS, adjacentRefs, getCell } from './board';
import { applyDamage, checkWin } from './damage';
import { endMoveCast, endTurn, isFirstTurn } from './turn';
import { resolveEffect } from './cards/effects';
import { getCard } from './cards/registry';

export function applyAction(state: GameState, action: Action): Result {
  if (state.winner !== null) return { ok: false, reason: 'Game is over', events: [] };
  const p = currentPlayer(state);
  switch (action.type) {
    case 'move': return doMove(state, p.id, action.dir);
    case 'punch': return doPunch(state, p.id, action.target);
    case 'cast': return doCast(state, p.id, action.cardId, action.target, action.energyCard);
    case 'use-item': return doUseItem(state, p.id, action.cardId, action.target);
    case 'pick-up-object': return doPickUpObject(state, p.id, action.objectId);
    case 'drop-item': return doDropItem(state, p.id, action.cardId);
    case 'pick-up-treasure': return doPickUpTreasure(state, p.id, action.treasureId);
    case 'drop-treasure': return doDropTreasure(state, p.id);
    case 'end-spell': return doEndSpell(state, p.id, action.index);
    case 'discard': return doDiscard(state, p.id, action.cardIds);
    case 'draw': return doDraw(state, p.id, action.count);
    case 'boost-speed': return doBoostSpeed(state, p.id, action.cardId);
    case 'counter': return doCounter(state, p.id, action.cardId, action.spellIndex);
    case 'end-turn': return doEndTurn(state, p.id);
    default: return { ok: false, reason: 'Unknown action', events: [] };
  }
}

function notTurn(state: GameState, id: number): Result | null {
  return currentPlayer(state).id !== id ? { ok: false, reason: 'Not your turn', events: [] } : null;
}
function notMoveCast(state: GameState): Result | null {
  return state.phase !== 'move-cast' ? { ok: false, reason: 'Cannot act now', events: [] } : null;
}

function doMove(state: GameState, id: number, dir: 'N' | 'S' | 'E' | 'W'): Result {
  const e = notTurn(state, id) ?? notMoveCast(state); if (e) return e;
  const p = currentPlayer(state);
  if (p.mp < 1) return { ok: false, reason: 'No MP left', events: [] };
  const dest = moveDestination(state.board, p.pos, dir, p.color);
  if (!dest) return { ok: false, reason: 'Cannot move that way', events: [] };
  const from = p.pos;
  p.pos = dest; p.mp -= 1;
  const events: GameEvent[] = [{ type: 'move', playerId: p.id, from, to: dest }];
  addLog(state, p.id, `${p.color} wizard moves`);
  return { ok: true, events };
}

function doPunch(state: GameState, id: number, target: number): Result {
  const e = notTurn(state, id) ?? notMoveCast(state); if (e) return e;
  const p = currentPlayer(state);
  if (p.attacked) return { ok: false, reason: 'Already attacked', events: [] };
  if (isFirstTurn(state)) return { ok: false, reason: 'No attacks on first turn', events: [] };
  const t = state.players.find((pl) => pl.id === target);
  if (!t || !t.alive) return { ok: false, reason: 'Invalid target', events: [] };
  if (!isAdjacent(p.pos, t.pos)) return { ok: false, reason: 'Target not adjacent', events: [] };
  p.attacked = true;
  const events: GameEvent[] = [];
  addLog(state, p.id, `${p.color} wizard punches ${t.color} wizard`);
  events.push(...applyDamage(state, t, 1, 'physical', p.id).events);
  checkWin(state, events);
  return { ok: true, events };
}

function isAdjacent(a: CellRef, b: CellRef): boolean {
  return adjacentRefs(a).some((r) => r.sector === b.sector && r.r === b.r && r.c === b.c);
}

function doCast(state: GameState, id: number, cardId: string, target?: TargetRef, energyCard?: string): Result {
  const e = notTurn(state, id) ?? notMoveCast(state); if (e) return e;
  const p = currentPlayer(state);
  const card = getCard(cardId);
  if (!card) return { ok: false, reason: 'Unknown card', events: [] };
  if (!p.hand.includes(cardId)) return { ok: false, reason: 'Card not in hand', events: [] };
  if (target) {
    const v = validateTarget(state, p, card, target);
    if (!v.ok) return v;
  }
  p.hand = p.hand.filter((c) => c !== cardId);
  let energy = card.energy;
  if (energyCard) {
    const ec = getCard(energyCard);
    if (!ec || ec.energyValue <= 0) return { ok: false, reason: 'Invalid energy card', events: [] };
    p.hand = p.hand.filter((c) => c !== energyCard);
    state.discard.push(energyCard);
    energy = ec.energyValue;
  }
  const events: GameEvent[] = [{ type: 'cast', playerId: p.id, cardId }];
  addLog(state, p.id, `${p.color} wizard casts ${card.name}`);
  if (card.type === 'attack-spell' || card.countsAsAttack) p.attacked = true;
  events.push(...resolveEffect(state, p, card, target ?? null, energy).events);
  checkWin(state, events);
  return { ok: true, events };
}

function validateTarget(state: GameState, p: GameState['players'][0], card: NonNullable<ReturnType<typeof getCard>>, target: TargetRef): Result {
  if (card.range === 'adjacent' && target.kind === 'wizard') {
    const t = state.players.find((pl) => pl.id === target.id);
    if (!t || !isAdjacent(p.pos, t.pos)) return { ok: false, reason: 'Target not adjacent', events: [] };
  } else if (card.range === 'los') {
    if (target.kind === 'wizard') {
      const t = state.players.find((pl) => pl.id === target.id);
      if (!t || !hasLOS(state.board, p.pos, t.pos)) return { ok: false, reason: 'No line of sight', events: [] };
    } else if (target.kind === 'cell') {
      if (!hasLOS(state.board, p.pos, target.ref)) return { ok: false, reason: 'No line of sight', events: [] };
    }
  }
  return { ok: true, events: [] };
}

function doUseItem(state: GameState, id: number, cardId: string, target?: TargetRef): Result {
  const e = notTurn(state, id) ?? notMoveCast(state); if (e) return e;
  const p = currentPlayer(state);
  const card = getCard(cardId);
  if (!card) return { ok: false, reason: 'Unknown card', events: [] };
  if (!p.carriedItems.includes(cardId)) return { ok: false, reason: 'Item not carried', events: [] };
  p.carriedItems = p.carriedItems.filter((c) => c !== cardId);
  const events: GameEvent[] = [];
  addLog(state, p.id, `${p.color} wizard uses ${card.name}`);
  events.push(...resolveEffect(state, p, card, target ?? null, card.energy).events);
  checkWin(state, events);
  return { ok: true, events };
}

function doPickUpObject(state: GameState, id: number, objectId: number): Result {
  const e = notTurn(state, id) ?? notMoveCast(state); if (e) return e;
  const p = currentPlayer(state);
  if (p.mp < 1) return { ok: false, reason: 'No MP left', events: [] };
  const cell = getCell(state.board, p.pos);
  const idx = cell.objects.findIndex((o) => o.id === objectId);
  if (idx === -1) return { ok: false, reason: 'Object not here', events: [] };
  if (handSize(p) >= MAX_HAND_SIZE) return { ok: false, reason: 'Hand full', events: [] };
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
  endMoveCast(state);
  return { ok: true, events: [] };
}

function doDropTreasure(state: GameState, id: number): Result {
  const e = notTurn(state, id) ?? notMoveCast(state); if (e) return e;
  const p = currentPlayer(state);
  if (p.carriedTreasure === null) return { ok: false, reason: 'Not carrying treasure', events: [] };
  getCell(state.board, p.pos).treasures.push(p.carriedTreasure);
  p.carriedTreasure = null;
  addLog(state, p.id, `${p.color} wizard drops treasure`);
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
  if (count > 2) return { ok: false, reason: 'Can only draw up to 2', events: [] };
  let drawn = 0;
  for (let i = 0; i < count; i++) {
    if (handSize(p) >= MAX_HAND_SIZE) break;
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
  const e = notTurn(state, id) ?? notMoveCast(state); if (e) return e;
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

function doCounter(state: GameState, id: number, cardId: string, _spellIndex: number): Result {
  const p = state.players.find((pl) => pl.id === id)!;
  const card = getCard(cardId);
  if (!card || card.type !== 'counter-spell') return { ok: false, reason: 'Not a counter spell', events: [] };
  if (!p.hand.includes(cardId)) return { ok: false, reason: 'Card not in hand', events: [] };
  p.hand = p.hand.filter((c) => c !== cardId);
  const events: GameEvent[] = [];
  addLog(state, p.id, `${p.color} wizard counters with ${card.name}`);
  events.push(...resolveEffect(state, p, card, null, card.energy).events);
  return { ok: true, events };
}

function doEndTurn(state: GameState, id: number): Result {
  const e = notTurn(state, id); if (e) return e;
  if (state.phase === 'move-cast') endMoveCast(state);
  return endTurn(state);
}