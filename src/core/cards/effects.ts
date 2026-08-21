// Effect resolver: walks the effect tree and applies state changes.

import type {
  GameState,
  PlayerState,
  CardDef,
  TargetRef,
  GameEvent,
  EffectNode,
} from '../types';
import { applyDamage, healWizard } from '../damage';
import { getCell, hasLOS } from '../board';
import { addLog } from '../state';

export interface EffectContext {
  state: GameState;
  caster: PlayerState;
  card: CardDef;
  target: TargetRef | null;
  energy: number;
}

export interface EffectResult {
  events: GameEvent[];
}

// Main entry point: resolve a card's effect.
export function resolveEffect(
  state: GameState,
  caster: PlayerState,
  card: CardDef,
  target: TargetRef | null,
  energy: number,
): EffectResult {
  const ctx: EffectContext = { state, caster, card, target, energy };
  const events: GameEvent[] = [];
  executeNode(ctx, card.effect, events);
  return { events };
}

function executeNode(ctx: EffectContext, node: EffectNode, events: GameEvent[]): void {
  const { state, caster, card, target, energy } = ctx;
  const op = node.op;

  switch (op) {
    case 'damage': {
      const amount = (node.amount as number) ?? 1;
      const kind = (node.kind as 'magical' | 'physical') ?? 'magical';
      const targets = resolveTargets(ctx, node);
      for (const t of targets) {
        if (t.kind === 'wizard') {
          const p = state.players.find((pl) => pl.id === t.id)!;
          events.push(...applyDamage(state, p, amount, kind, caster.id).events);
        }
      }
      break;
    }

    case 'heal': {
      const amount = (node.amount as number) ?? 1;
      const t = target ?? { kind: 'self' as const };
      if (t.kind === 'wizard') {
        const p = state.players.find((pl) => pl.id === t.id)!;
        events.push(...healWizard(state, p, amount));
      } else if (t.kind === 'self') {
        events.push(...healWizard(state, caster, amount));
      }
      break;
    }

    case 'apply-spell': {
      // Create a maintained spell.
      const spellEnergy = (node.energy as number) ?? energy;
      caster.maintainedSpells.push({
        cardId: card.id,
        energy: spellEnergy,
        target: target,
        owner: caster.id,
      });
      addLog(state, caster.id, `${caster.color} wizard maintains ${card.name}`);
      break;
    }

    case 'create-object': {
      const objectCardId = node.object as string;
      const t = target;
      if (t && t.kind === 'cell') {
        const cell = getCell(state.board, t.ref);
        cell.objects.push({ cardId: objectCardId, id: state.nextObjectId++, owner: caster.id });
        addLog(state, caster.id, `${caster.color} wizard creates an object`);
      }
      break;
    }

    case 'destroy-object': {
      const t = target;
      if (t && t.kind === 'cell') {
        const cell = getCell(state.board, t.ref);
        cell.objects = [];
        addLog(state, caster.id, `${caster.color} wizard destroys objects`);
      }
      break;
    }

    case 'teleport': {
      const t = target;
      if (t && t.kind === 'cell') {
        caster.pos = t.ref;
        addLog(state, caster.id, `${caster.color} wizard teleports`);
      }
      break;
    }

    case 'stun': {
      const t = target;
      if (t && t.kind === 'wizard') {
        const p = state.players.find((pl) => pl.id === t.id)!;
        p.stunTokens += 1;
        addLog(state, caster.id, `${caster.color} wizard stuns ${p.color} wizard`);
      }
      break;
    }

    case 'draw': {
      const count = (node.count as number) ?? 1;
      for (let i = 0; i < count; i++) {
        const c = state.deck.pop();
        if (c) caster.hand.push(c);
      }
      addLog(state, caster.id, `${caster.color} wizard draws ${count} cards`);
      break;
    }

    case 'discard': {
      const count = (node.count as number) ?? 1;
      for (let i = 0; i < count && caster.hand.length > 0; i++) {
        const c = caster.hand.pop()!;
        state.discard.push(c);
      }
      addLog(state, caster.id, `${caster.color} wizard discards ${count} cards`);
      break;
    }

    case 'steal-treasure': {
      const t = target;
      if (t && t.kind === 'wizard') {
        const p = state.players.find((pl) => pl.id === t.id)!;
        if (p.carriedTreasure !== null) {
          const treasure = p.carriedTreasure;
          p.carriedTreasure = null;
          getCell(state.board, p.pos).treasures.push(treasure);
          addLog(state, caster.id, `${caster.color} wizard steals treasure`);
        }
      }
      break;
    }

    case 'transform': {
      caster.transformed = card.id;
      addLog(state, caster.id, `${caster.color} wizard transforms`);
      break;
    }

    case 'shield': {
      // Shield: prevent next damage.
      // Stored as a maintained spell with special handling.
      caster.maintainedSpells.push({
        cardId: card.id,
        energy: (node.energy as number) ?? energy,
        target: { kind: 'self' },
        owner: caster.id,
      });
      addLog(state, caster.id, `${caster.color} wizard casts a shield`);
      break;
    }

    case 'negate': {
      // End a target maintained spell.
      const t = target;
      if (t && t.kind === 'wizard') {
        const p = state.players.find((pl) => pl.id === t.id)!;
        if (p.maintainedSpells.length > 0) {
          const spell = p.maintainedSpells.pop()!;
          state.discard.push(spell.cardId);
          addLog(state, caster.id, `${caster.color} wizard negates a spell on ${p.color} wizard`);
        }
      } else if (t && t.kind === 'spell') {
        for (const p of state.players) {
          if (t.index >= 0 && t.index < p.maintainedSpells.length) {
            const spell = p.maintainedSpells.splice(t.index, 1)[0];
            state.discard.push(spell.cardId);
            addLog(state, caster.id, `${caster.color} wizard negates a spell`);
            break;
          }
        }
      }
      break;
    }

    case 'absorb': {
      // Absorb: take over a spell.
      addLog(state, caster.id, `${caster.color} wizard absorbs a spell`);
      break;
    }

    case 'rotate-sector': {
      const t = target;
      if (t && t.kind === 'cell') {
        const sector = state.board.sectors[t.ref.sector];
        sector.rotation = (sector.rotation + 1) % 4;
        addLog(state, caster.id, `${caster.color} wizard rotates a sector`);
      }
      break;
    }

    case 'seal-door': {
      const t = target;
      if (t && t.kind === 'door') {
        const cell = getCell(state.board, { sector: t.ref.sector, r: t.ref.r, c: t.ref.c });
        const door = cell.doors[t.ref.side];
        if (door) {
          door.sealed = true;
          addLog(state, caster.id, `${caster.color} wizard seals a door`);
        }
      }
      break;
    }

    case 'pick-lock': {
      const t = target;
      if (t && t.kind === 'door') {
        const cell = getCell(state.board, { sector: t.ref.sector, r: t.ref.r, c: t.ref.c });
        const door = cell.doors[t.ref.side];
        if (door && !door.sealed) {
          door.locked = false;
          door.heldOpenBy = caster.id;
          addLog(state, caster.id, `${caster.color} wizard picks a lock`);
        }
      }
      break;
    }

    case 'drop-object': {
      // Force target wizard to drop 1 treasure or carried item.
      const t = target;
      if (t && t.kind === 'wizard') {
        const p = state.players.find((pl) => pl.id === t.id)!;
        const cell = getCell(state.board, p.pos);
        if (p.carriedTreasure !== null) {
          cell.treasures.push(p.carriedTreasure);
          p.carriedTreasure = null;
          addLog(state, caster.id, `${caster.color} wizard forces ${p.color} wizard to drop treasure`);
        } else if (p.carriedItems.length > 0) {
          const cardId = p.carriedItems.pop()!;
          cell.objects.push({ cardId, id: state.nextObjectId++, owner: null });
          addLog(state, caster.id, `${caster.color} wizard forces ${p.color} wizard to drop an item`);
        }
      }
      break;
    }

    case 'swap-positions': {
      const t = target;
      if (t && t.kind === 'wizard') {
        const p = state.players.find((pl) => pl.id === t.id)!;
        const tmp = caster.pos;
        caster.pos = p.pos;
        p.pos = tmp;
        addLog(state, caster.id, `${caster.color} wizard swaps positions`);
      }
      break;
    }

    case 'share-life': {
      // Average life between caster and target (caster gets the extra point).
      const t = target;
      if (t && t.kind === 'wizard') {
        const p = state.players.find((pl) => pl.id === t.id)!;
        const total = caster.life + p.life;
        caster.life = Math.ceil(total / 2);
        p.life = Math.floor(total / 2);
        addLog(state, caster.id, `${caster.color} wizard shares life with ${p.color} wizard (${caster.life}/${p.life})`);
      }
      break;
    }

    case 'no-op':
    case 'item':
    case 'energy':
      // Cards whose effect is handled elsewhere (items via use-item, energy via
      // boost-speed) or not yet implemented. No state change here.
      break;

    default:
      // Unknown op: log and continue.
      addLog(state, caster.id, `Unknown effect op: ${op}`);
      break;
  }
}

// Resolve targets for an effect.
function resolveTargets(ctx: EffectContext, node: EffectNode): TargetRef[] {
  const { state, caster, target } = ctx;
  const targetsMode = node.targets as string | undefined;

  if (targetsMode === 'all-in-range') {
    // All wizards in range.
    const targets: TargetRef[] = [];
    for (const p of state.players) {
      if (p.id === caster.id || !p.alive) continue;
      if (hasLOS(state.board, caster.pos, p.pos)) {
        targets.push({ kind: 'wizard', id: p.id });
      }
    }
    return targets;
  }

  if (target) {
    return [target];
  }
  return [];
}