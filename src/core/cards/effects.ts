// Effect resolver: walks the effect tree and applies state changes.

import type {
  GameState,
  PlayerState,
  CardDef,
  TargetRef,
  GameEvent,
  EffectNode,
  MaintainedSpell,
} from '../types';
import { applyDamage, healWizard } from '../damage';
import { getCell, hasLOS, moveDestination } from '../board';
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
      // M2: Energy-based damage calculation.
      // If amount is '@energy', use the energy value directly.
      // If amount is '@energy+N', use energy + N.
      // Otherwise, damage = base amount + (energy - 1).
      const amountSpec = node.amount;
      const kind = (node.kind as 'magical' | 'physical') ?? 'magical';
      let amount: number;
      if (amountSpec === '@energy') {
        amount = energy;
      } else if (typeof amountSpec === 'string' && amountSpec.startsWith('@energy+')) {
        const bonus = parseInt(amountSpec.substring(8), 10);
        amount = energy + bonus;
      } else {
        const baseAmount = (amountSpec as number) ?? 1;
        amount = baseAmount + (energy - 1);
      }
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
      
      // Determine behavior and meta from effect node.
      let behavior: MaintainedSpell['behavior'] | undefined;
      let meta: Record<string, number | string> | undefined;
      
      if (node.when === 'time-passes' && node.timePassesDamage) {
        behavior = 'time-passes-damage';
        meta = { dmg: node.timePassesDamage as number };
      } else if (node.modifier) {
        behavior = 'modifier';
        meta = { type: node.modifier as string };
      }
      
      caster.maintainedSpells.push({
        cardId: card.id,
        energy: spellEnergy,
        target: target,
        owner: caster.id,
        behavior,
        meta,
      });
      addLog(state, caster.id, `${caster.color} wizard maintains ${card.name}`);
      break;
    }

    case 'create-object': {
      const objectCardId = node.object as string;
      const t = target;
      if (t && t.kind === 'cell') {
        const cell = getCell(state.board, t.ref);
        
        // M5: Placement validation.
        // Cannot place on home cells.
        if (cell.kind === 'home') {
          addLog(state, caster.id, `Cannot create object on home cell`);
          break;
        }
        // Cannot place if cell already has objects.
        if (cell.objects.length > 0) {
          addLog(state, caster.id, `Cannot create object: cell already has objects`);
          break;
        }
        // Cannot place if cell has treasures.
        if (cell.treasures.length > 0) {
          addLog(state, caster.id, `Cannot create object: cell has treasures`);
          break;
        }
        // Cannot place if cell has a wizard.
        const wizardHere = state.players.find((p) => 
          p.alive && p.pos.sector === t.ref.sector && p.pos.r === t.ref.r && p.pos.c === t.ref.c
        );
        if (wizardHere) {
          addLog(state, caster.id, `Cannot create object: wizard is here`);
          break;
        }
        
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
      // §17.2.4: Set initial transformation energy for temporary transformations.
      if (card.duration === 'temporary') {
        caster.transformEnergy = card.energy ?? 1;
      }
      addLog(state, caster.id, `${caster.color} wizard transforms`);
      break;
    }

    case 'shield': {
      // §17.2.3: Shield: reduce damage by energy + 2.
      // Stored as a maintained spell with 'shield' behavior.
      caster.maintainedSpells.push({
        cardId: card.id,
        energy: (node.energy as number) ?? energy,
        target: { kind: 'self' },
        owner: caster.id,
        behavior: 'shield',
      });
      addLog(state, caster.id, `${caster.color} wizard casts a shield (reduces damage by ${((node.energy as number) ?? energy) + 2})`);
      break;
    }

    case 'negate': {
      // End a target maintained spell or transformation.
      const t = target;
      if (t && t.kind === 'wizard') {
        const p = state.players.find((pl) => pl.id === t.id)!;
        // §17.2.4: Negate can end transformations.
        if (p.transformed) {
          addLog(state, caster.id, `${caster.color} wizard negates ${p.color} wizard's transformation`);
          p.transformed = null;
          p.transformEnergy = undefined;
        } else if (p.maintainedSpells.length > 0) {
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
        addLog(state, caster.id, `${caster.color} wizard rotates a sector (rotation=${sector.rotation})`);
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

    case 'meditate': {
      // Draw 3 cards, then discard down to hand limit.
      const drawCount = 3;
      for (let i = 0; i < drawCount; i++) {
        const c = state.deck.pop();
        if (c) caster.hand.push(c);
      }
      // Discard down to hand limit (7).
      const MAX_HAND = 7;
      while (caster.hand.length > MAX_HAND) {
        const c = caster.hand.pop()!;
        state.discard.push(c);
      }
      addLog(state, caster.id, `${caster.color} wizard meditates (draws 3, discards to limit)`);
      break;
    }

    case 'move-through-wall': {
      // Move caster through a wall to the adjacent cell.
      const t = target;
      if (t && t.kind === 'wall') {
        const dir = t.ref.side;
        const delta = { N: { dr: -1, dc: 0 }, S: { dr: 1, dc: 0 }, E: { dr: 0, dc: 1 }, W: { dr: 0, dc: -1 } }[dir];
        const newR = t.ref.r + delta.dr;
        const newC = t.ref.c + delta.dc;
        if (newR >= 0 && newR < 5 && newC >= 0 && newC < 5) {
          caster.pos = { sector: t.ref.sector, r: newR, c: newC };
          addLog(state, caster.id, `${caster.color} wizard passes through wall`);
        }
      }
      break;
    }

    case 'eat-wall': {
      // Destroy a wall and heal caster.
      const t = target;
      if (t && t.kind === 'wall') {
        const wallCell = getCell(state.board, t.ref);
        wallCell.walls[t.ref.side] = false;
        const healAmount = 2;
        events.push(...healWizard(state, caster, healAmount));
        addLog(state, caster.id, `${caster.color} wizard eats wall (+${healAmount} life)`);
      }
      break;
    }

    case 'pain-link': {
      // Maintain spell: reflect damage back to attacker.
      caster.maintainedSpells.push({
        cardId: card.id,
        energy: energy,
        target: { kind: 'self' },
        owner: caster.id,
        behavior: 'modifier',
        meta: { type: 'pain-link' },
      });
      addLog(state, caster.id, `${caster.color} wizard casts Pain Link`);
      break;
    }

    case 'strength': {
      // Maintain spell: double physical damage.
      caster.maintainedSpells.push({
        cardId: card.id,
        energy: energy,
        target: { kind: 'self' },
        owner: caster.id,
        behavior: 'modifier',
        meta: { type: 'strength' },
      });
      addLog(state, caster.id, `${caster.color} wizard casts Strength`);
      break;
    }

    case 'invisible': {
      // Maintain spell: dodge attacks (roll d6, dodge on 3+).
      caster.maintainedSpells.push({
        cardId: card.id,
        energy: energy,
        target: { kind: 'self' },
        owner: caster.id,
        behavior: 'modifier',
        meta: { type: 'invisible' },
      });
      addLog(state, caster.id, `${caster.color} wizard casts Invisible`);
      break;
    }

    case 'fire-cloak': {
      // Maintain spell: punch deals +2 fire damage.
      caster.maintainedSpells.push({
        cardId: card.id,
        energy: energy,
        target: { kind: 'self' },
        owner: caster.id,
        behavior: 'modifier',
        meta: { type: 'fire-cloak' },
      });
      addLog(state, caster.id, `${caster.color} wizard casts Fire Cloak`);
      break;
    }

    case 'adrenaline': {
      // Maintain spell: two attacks per turn.
      caster.maintainedSpells.push({
        cardId: card.id,
        energy: energy,
        target: { kind: 'self' },
        owner: caster.id,
        behavior: 'modifier',
        meta: { type: 'adrenaline' },
      });
      addLog(state, caster.id, `${caster.color} wizard casts Adrenaline`);
      break;
    }

    case 'extra-arms': {
      // Maintain spell: carried items don't count toward hand limit.
      caster.maintainedSpells.push({
        cardId: card.id,
        energy: energy,
        target: { kind: 'self' },
        owner: caster.id,
        behavior: 'modifier',
        meta: { type: 'extra-arms' },
      });
      addLog(state, caster.id, `${caster.color} wizard casts Extra Arms`);
      break;
    }

    case 'bloodshard': {
      // Maintain spell: reduce incoming damage by 1.
      caster.maintainedSpells.push({
        cardId: card.id,
        energy: energy,
        target: { kind: 'self' },
        owner: caster.id,
        behavior: 'modifier',
        meta: { type: 'bloodshard' },
      });
      addLog(state, caster.id, `${caster.color} wizard casts Bloodshard`);
      break;
    }

    case 'shatter': {
      // Maintain spell: double cracks on objects.
      caster.maintainedSpells.push({
        cardId: card.id,
        energy: energy,
        target: { kind: 'self' },
        owner: caster.id,
        behavior: 'modifier',
        meta: { type: 'shatter' },
      });
      addLog(state, caster.id, `${caster.color} wizard casts Shatter`);
      break;
    }

    case 'around-the-corner': {
      // Allow casting around corners (LOS relaxation).
      // This spell modifies the caster's LOS for the next cast.
      // We store this as a temporary buff on the caster.
      caster.maintainedSpells.push({
        cardId: card.id,
        energy: energy,
        target: { kind: 'self' },
        owner: caster.id,
        behavior: 'modifier',
        meta: { type: 'around-the-corner' },
      });
      addLog(state, caster.id, `${caster.color} wizard casts Around the Corner (can cast around corners)`);
      break;
    }

    case 'move-line': {
      // Move in a straight line for a number of squares equal to this spell's energy.
      // The wizard chooses a direction and moves that many squares.
      // Direction can be specified in the effect node or target.
      let dir: 'N' | 'S' | 'E' | 'W' = 'N'; // Default to north
      
      // Check if direction is specified in the effect node.
      if (node.dir) {
        dir = node.dir as 'N' | 'S' | 'E' | 'W';
      }
      // Check if direction is specified in the target (as a cell ref).
      else if (target && target.kind === 'cell') {
        const dr = target.ref.r - caster.pos.r;
        const dc = target.ref.c - caster.pos.c;
        if (dr === -1) dir = 'N';
        else if (dr === 1) dir = 'S';
        else if (dc === 1) dir = 'E';
        else if (dc === -1) dir = 'W';
      }
      
      let moved = 0;
      let currentPos = { ...caster.pos };
      
      for (let i = 0; i < energy; i++) {
        const nextPos = moveDestination(state.board, currentPos, dir, caster.color);
        if (!nextPos) break;
        
        // Check if the cell is blocked by an object.
        const sector = state.board.sectors[nextPos.sector];
        const cell = sector.grid[nextPos.r][nextPos.c];
        if (cell.objects.some((obj: { cardId: string }) => obj.cardId === 'cantrip-stone-block')) break;
        
        currentPos = nextPos;
        moved++;
      }
      
      if (moved > 0) {
        caster.pos = currentPos;
        addLog(state, caster.id, `${caster.color} wizard uses Windrider (moved ${moved} squares ${dir})`);
      } else {
        addLog(state, caster.id, `${caster.color} wizard uses Windrider (couldn't move)`);
      }
      break;
    }

    case 'add': {
      // Combine the energy values of 2 Magic cards together.
      // This spell allows the caster to combine energy from 2 cards.
      // We store this as a buff that adds energy to the next cast.
      caster.maintainedSpells.push({
        cardId: card.id,
        energy: energy,
        target: { kind: 'self' },
        owner: caster.id,
        behavior: 'modifier',
        meta: { type: 'add', bonusEnergy: energy },
      });
      addLog(state, caster.id, `${caster.color} wizard uses Add (+${energy} energy to next cast)`);
      break;
    }

    case 'create-creature': {
      // Create a creature entity (e.g., Homunculus).
      // The creature is placed in the target cell and acts as an ally.
      const creatureType = node.object as string;
      const t = target;
      if (t && t.kind === 'cell') {
        const cell = state.board.sectors[t.ref.sector].grid[t.ref.r][t.ref.c];
        
        // Check if the cell is valid for creature placement.
        if (cell.kind === 'home' || cell.objects.length > 0 || cell.treasures.length > 0) {
          addLog(state, caster.id, `Cannot create creature: invalid cell`);
          break;
        }
        
        // Create the creature as an object with special properties.
        cell.objects.push({
          cardId: creatureType,
          id: state.nextObjectId++,
          owner: caster.id,
          cracks: 5, // Homunculus has 5 HP
          destroyed: false,
        });
        
        addLog(state, caster.id, `${caster.color} wizard creates a ${creatureType} (5 HP, 1 speed)`);
      }
      break;
    }

    case 'fools-gold': {
      // When an enemy wizard picks up a treasure in your home sector, deal 3 magical damage to them.
      // We store this as a maintained spell that triggers on treasure pickup.
      caster.maintainedSpells.push({
        cardId: card.id,
        energy: energy,
        target: { kind: 'self' },
        owner: caster.id,
        behavior: 'modifier',
        meta: { type: 'fools-gold' },
      });
      addLog(state, caster.id, `${caster.color} wizard casts Fool's Gold (triggers on enemy treasure pickup in home)`);
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