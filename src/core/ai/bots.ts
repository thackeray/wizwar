// AI player interface and built-in bots.

import type { GameState, Action, TargetRef, Color, CellRef, Dir } from '../types';
import { DIR_DELTA } from '../types';
import { getCard } from '../cards/registry';
import { adjacentRefs, hasLOS, toGlobal, getCell, wallBetween, moveDestination } from '../board';
import { currentPlayer, handSize, MAX_HAND_SIZE, homeRef } from '../state';

// BFS pathfinding: returns the first step (dir) to take from `from` to reach `to`.
export function bfsFirstStep(state: GameState, from: CellRef, to: CellRef): Dir | null {
  const board = state.board;
  const color = state.players.find(p => p.pos.sector === from.sector && p.pos.r === from.r && p.pos.c === from.c)?.color ?? 'blue';
  const visited = new Set<string>();
  const queue: { ref: CellRef; firstDir: Dir | null }[] = [{ ref: from, firstDir: null }];
  visited.add(`${from.sector},${from.r},${from.c}`);

  while (queue.length > 0) {
    const { ref, firstDir } = queue.shift()!;
    
    // Check if we reached the target.
    if (ref.sector === to.sector && ref.r === to.r && ref.c === to.c) {
      return firstDir;
    }

    // Explore neighbors using moveDestination (handles cross-sector doors).
    for (const dir of ['N', 'S', 'E', 'W'] as Dir[]) {
      const next = moveDestination(board, ref, dir, color);
      if (!next) continue;
      
      // M7: Check for blocking objects (Stone Block).
      const nextCell = board.sectors[next.sector].grid[next.r][next.c];
      const hasBlockingObject = nextCell.objects.some((obj) => 
        obj.cardId === 'cantrip-stone-block'
      );
      if (hasBlockingObject) continue;
      
      const key = `${next.sector},${next.r},${next.c}`;
      if (visited.has(key)) continue;
      visited.add(key);
      
      queue.push({ ref: next, firstDir: firstDir ?? dir });
    }
  }
  
  return null; // No path found.
}

export interface AIPlayer {
  name: string;
  chooseAction(state: GameState, legalActions: Action[]): Promise<Action>;
  chooseCounter?(state: GameState, pending: { cardId: string; caster: number }, myHand: string[]): Promise<{ cardId: string } | null>;
}

// Generate all legal actions for a player (for AI and UI).
export function getLegalActions(state: GameState, playerId: number): Action[] {
  const actions: Action[] = [];
  const p = state.players.find((pl) => pl.id === playerId)!;
  if (!p.alive || state.winner !== null) return actions;

  if (state.phase === 'move-cast') {
    // Move actions (filtered by walls).
    if (p.mp >= 1) {
      for (const dir of ['N', 'S', 'E', 'W'] as const) {
        if (!wallBetween(state.board, p.pos, dir)) {
          actions.push({ type: 'move', dir });
        }
      }
    }
    // Punch action.
    if (!p.attacked && state.turnNumber > 1) {
      for (const t of state.players) {
        if (t.id !== p.id && t.alive && isAdjacent(p.pos, t.pos)) {
          actions.push({ type: 'punch', target: t.id });
        }
      }
    }
    // Cast actions with targets.
    for (const cardId of p.hand) {
      const card = getCard(cardId);
      if (card && (card.type === 'attack-spell' || card.type === 'neutral-spell' || card.type === 'transform')) {
        // §14.4: Skip attack spells if already attacked.
        if (card.type === 'attack-spell' && p.attacked) continue;
        const targets = targetsForCard(state, p, card);
        if (targets.length > 0) {
          for (const target of targets) {
            actions.push({ type: 'cast', cardId, target });
          }
        } else {
          // No target needed (self-cast or no-target spell).
          actions.push({ type: 'cast', cardId });
        }
      }
    }
    // Use item actions with targets.
    for (const cardId of p.carriedItems) {
      const card = getCard(cardId);
      if (card) {
        const targets = targetsForCard(state, p, card);
        if (targets.length > 0) {
          for (const target of targets) {
            actions.push({ type: 'use-item', cardId, target });
          }
        } else {
          actions.push({ type: 'use-item', cardId });
        }
      }
    }
    // §15.1: Pick up treasure if on a treasure cell and not already carrying.
    const currentCell = getCell(state.board, p.pos);
    if (p.carriedTreasure === null && currentCell.treasures.length > 0) {
      for (const treasureId of currentCell.treasures) {
        actions.push({ type: 'pick-up-treasure', treasureId });
      }
    }
    // §15.1: Drop treasure if carrying one.
    if (p.carriedTreasure !== null) {
      actions.push({ type: 'drop-treasure' });
    }
    // §15.1: Pick up objects if on a cell with objects and hand not full.
    if (handSize(p) < MAX_HAND_SIZE && currentCell.objects.length > 0) {
      for (const obj of currentCell.objects) {
        actions.push({ type: 'pick-up-object', objectId: obj.id });
      }
    }
    // §15.1: Attack objects (walls/doors) if adjacent.
    if (!p.attacked && state.turnNumber > 1) {
      for (const dir of ['N', 'S', 'E', 'W'] as const) {
        const door = currentCell.doors[dir];
        if (door && !door.destroyed) {
          actions.push({ type: 'attack-object', target: { kind: 'door', ref: { ...p.pos, side: dir } } });
        }
        if (currentCell.walls[dir]) {
          actions.push({ type: 'attack-object', target: { kind: 'wall', ref: { ...p.pos, side: dir } } });
        }
      }
    }
    // §16.4.3: Boost speed if player has energy card and hasn't boosted yet.
    if (!p.speedBoosted) {
      for (const cardId of p.hand) {
        const card = getCard(cardId);
        if (card && card.energyValue > 0) {
          actions.push({ type: 'boost-speed', cardId });
          break; // Only add one boost-speed action.
        }
      }
    }
    // §16.4.3: Drop item if player has carried items.
    if (p.carriedItems.length > 0) {
      for (const cardId of p.carriedItems) {
        actions.push({ type: 'drop-item', cardId });
      }
    }
    // §16.4.3: End spell if player has maintained spells.
    if (p.maintainedSpells.length > 0) {
      for (let i = 0; i < p.maintainedSpells.length; i++) {
        actions.push({ type: 'end-spell', index: i });
      }
    }
    // §16.4.3: Cast with energyCard fuel for energy damage cards.
    for (const cardId of p.hand) {
      const card = getCard(cardId);
      if (card && card.type === 'attack-spell' && !p.attacked) {
        // Check if this card uses energy damage.
        const usesEnergyDamage = card.effect?.amount === '@energy';
        if (usesEnergyDamage) {
          // Add cast actions with energy card fuel.
          for (const fuelCardId of p.hand) {
            if (fuelCardId === cardId) continue;
            const fuelCard = getCard(fuelCardId);
            if (fuelCard && fuelCard.energyValue > 0) {
              const targets = targetsForCard(state, p, card);
              if (targets.length > 0) {
                for (const target of targets) {
                  actions.push({ type: 'cast', cardId, target, energyCard: fuelCardId });
                }
              } else {
                actions.push({ type: 'cast', cardId, energyCard: fuelCardId });
              }
              break; // Only add one fuel variant per card.
            }
          }
        }
      }
    }
    // End turn.
    actions.push({ type: 'end-turn' });
  } else if (state.phase === 'discard-draw') {
    // Discard actions.
    if (p.hand.length > 0) {
      actions.push({ type: 'discard', cardIds: [p.hand[0]] });
    }
    // Draw actions (only if hand not full).
    if (handSize(p) < MAX_HAND_SIZE) {
      actions.push({ type: 'draw', count: 1 });
      actions.push({ type: 'draw', count: 2 });
    }
    // End turn.
    actions.push({ type: 'end-turn' });
  }

  return actions;
}

// M2: Generate targets for a card.
function targetsForCard(state: GameState, p: GameState['players'][0], card: NonNullable<ReturnType<typeof getCard>>): TargetRef[] {
  const targets: TargetRef[] = [];
  const maxTargets = 8;
  
  if (card.target === 'wizard') {
    // All wizards in range.
    for (const t of state.players) {
      if (t.id === p.id || !t.alive) continue;
      if (card.range === 'adjacent' && isAdjacent(p.pos, t.pos)) {
        targets.push({ kind: 'wizard', id: t.id });
      } else if (card.range === 'los' && hasLOS(state.board, p.pos, t.pos, p.color)) {
        targets.push({ kind: 'wizard', id: t.id });
      } else if (card.range === 'anywhere' || card.range === 'same-sector') {
        if (card.range === 'same-sector' && t.pos.sector !== p.pos.sector) continue;
        targets.push({ kind: 'wizard', id: t.id });
      }
      if (targets.length >= maxTargets) break;
    }
  } else if (card.target === 'self') {
    // Only self.
    targets.push({ kind: 'wizard', id: p.id });
  } else if (card.target === 'door') {
    // All doors in range.
    for (const sectorColor of Object.keys(state.board.sectors) as Color[]) {
      const sector = state.board.sectors[sectorColor];
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          const cell = sector.grid[r][c];
          const cellRef = { sector: sectorColor, r, c };
          for (const dir of ['N', 'S', 'E', 'W'] as const) {
            const door = cell.doors[dir];
            if (door && !door.destroyed) {
              if (card.range === 'adjacent' && isAdjacent(p.pos, cellRef)) {
                targets.push({ kind: 'door', ref: { ...cellRef, side: dir } });
              } else if (card.range === 'los' && hasLOS(state.board, p.pos, cellRef, p.color)) {
                targets.push({ kind: 'door', ref: { ...cellRef, side: dir } });
              } else if (card.range === 'anywhere') {
                targets.push({ kind: 'door', ref: { ...cellRef, side: dir } });
              }
              if (targets.length >= maxTargets) break;
            }
          }
          if (targets.length >= maxTargets) break;
        }
        if (targets.length >= maxTargets) break;
      }
      if (targets.length >= maxTargets) break;
    }
  } else if (card.target === 'wall') {
    // All walls in range.
    for (const sectorColor of Object.keys(state.board.sectors) as Color[]) {
      const sector = state.board.sectors[sectorColor];
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          const cell = sector.grid[r][c];
          const cellRef = { sector: sectorColor, r, c };
          for (const dir of ['N', 'S', 'E', 'W'] as const) {
            if (cell.walls[dir]) {
              if (card.range === 'adjacent' && isAdjacent(p.pos, cellRef)) {
                targets.push({ kind: 'wall', ref: { ...cellRef, side: dir } });
              } else if (card.range === 'los' && hasLOS(state.board, p.pos, cellRef, p.color)) {
                targets.push({ kind: 'wall', ref: { ...cellRef, side: dir } });
              } else if (card.range === 'anywhere') {
                targets.push({ kind: 'wall', ref: { ...cellRef, side: dir } });
              }
              if (targets.length >= maxTargets) break;
            }
          }
          if (targets.length >= maxTargets) break;
        }
        if (targets.length >= maxTargets) break;
      }
      if (targets.length >= maxTargets) break;
    }
  } else if (card.target === 'object') {
    // All objects in range.
    for (const sectorColor of Object.keys(state.board.sectors) as Color[]) {
      const sector = state.board.sectors[sectorColor];
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          const cell = sector.grid[r][c];
          const cellRef = { sector: sectorColor, r, c };
          for (const obj of cell.objects) {
            if (card.range === 'adjacent' && isAdjacent(p.pos, cellRef)) {
              targets.push({ kind: 'object', id: obj.id });
            } else if (card.range === 'los' && hasLOS(state.board, p.pos, cellRef, p.color)) {
              targets.push({ kind: 'object', id: obj.id });
            } else if (card.range === 'anywhere') {
              targets.push({ kind: 'object', id: obj.id });
            }
            if (targets.length >= maxTargets) break;
          }
          if (targets.length >= maxTargets) break;
        }
        if (targets.length >= maxTargets) break;
      }
      if (targets.length >= maxTargets) break;
    }
  } else if (card.target === 'square') {
    // All squares in range.
    for (const sectorColor of Object.keys(state.board.sectors) as Color[]) {
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          const cellRef = { sector: sectorColor, r, c };
          if (card.range === 'adjacent' && isAdjacent(p.pos, cellRef)) {
            targets.push({ kind: 'cell', ref: cellRef });
          } else if (card.range === 'los' && hasLOS(state.board, p.pos, cellRef, p.color)) {
            targets.push({ kind: 'cell', ref: cellRef });
          } else if (card.range === 'anywhere') {
            targets.push({ kind: 'cell', ref: cellRef });
          }
          if (targets.length >= maxTargets) break;
        }
        if (targets.length >= maxTargets) break;
      }
      if (targets.length >= maxTargets) break;
    }
  }
  
  return targets;
}

function isAdjacent(a: { sector: string; r: number; c: number }, b: { sector: string; r: number; c: number }): boolean {
  return adjacentRefs(a as any).some((r) => r.sector === b.sector && r.r === b.r && r.c === b.c);
}

// Random bot: picks a random legal action.
export class RandomBot implements AIPlayer {
  name = 'Random Bot';
  async chooseAction(_state: GameState, legalActions: Action[]): Promise<Action> {
    if (legalActions.length === 0) return { type: 'end-turn' };
    return legalActions[Math.floor(Math.random() * legalActions.length)];
  }
  
  async chooseCounter(state: GameState, pending: { cardId: string; caster: number }, myHand: string[]): Promise<{ cardId: string } | null> {
    // Randomly decide whether to counter (50% chance).
    // Use state and pending to satisfy the interface.
    void state;
    void pending;
    if (Math.random() < 0.5 && myHand.length > 0) {
      // Pick a random card from hand.
      const cardId = myHand[Math.floor(Math.random() * myHand.length)];
      return { cardId };
    }
    return null;
  }
}

// Heuristic bot: simple strategy-based decisions.
export class HeuristicBot implements AIPlayer {
  name = 'Heuristic Bot';
  async chooseAction(state: GameState, legalActions: Action[]): Promise<Action> {
    const p = currentPlayer(state);

    // In discard-draw phase, draw cards and end turn.
    if (state.phase === 'discard-draw') {
      const draw = legalActions.find((a) => a.type === 'draw' && a.count === 2);
      if (draw) return draw;
      return { type: 'end-turn' };
    }

    // §15.5: Priority 0: Drop treasure if on our own home cell.
    if (p.carriedTreasure !== null) {
      const currentCell = getCell(state.board, p.pos);
      if (currentCell.kind === 'home' && p.pos.sector === p.color) {
        const dropTreasure = legalActions.find((a) => a.type === 'drop-treasure');
        if (dropTreasure) return dropTreasure;
      }
    }

    // §15.5: Priority 1: Pick up enemy treasure if available.
    const pickupTreasure = legalActions.find((a) => {
      if (a.type !== 'pick-up-treasure') return false;
      const treasureId = (a as any).treasureId;
      // Only pick up enemy treasures (treasureHome !== p.color).
      if (treasureId === undefined || state.treasureHome[treasureId] === p.color) return false;
      // §15.6: Skip treasures already banked in our own home (already scored) —
      // picking them up then re-dropping would churn VP in a pickup/drop loop.
      const cell = getCell(state.board, p.pos);
      if (cell.kind === 'home' && p.pos.sector === p.color) return false;
      return true;
    });
    if (pickupTreasure) return pickupTreasure;

    // §15.6: Priority 1.5: If carrying treasure, move toward our own home (before punching).
    if (p.carriedTreasure !== null) {
      const moves = legalActions.filter((a) => a.type === 'move');
      if (moves.length > 0) {
        const target = homeRef(p.color);
        const firstDir = bfsFirstStep(state, p.pos, target);
        if (firstDir) {
          const moveAction = moves.find((a) => a.dir === firstDir);
          if (moveAction) return moveAction;
        }
      }
    }

    // Priority 2: Punch if adjacent enemy exists.
    const punch = legalActions.find((a) => a.type === 'punch');
    if (punch) return punch;

    // Priority 3: Cast attack spells if any enemy is in LOS.
    for (const a of legalActions) {
      if (a.type !== 'cast') continue;
      const card = getCard(a.cardId);
      if (card && card.type === 'attack-spell') {
        for (const t of state.players) {
          if (t.id !== p.id && t.alive && hasLOS(state.board, p.pos, t.pos)) {
            return { type: 'cast', cardId: a.cardId, target: { kind: 'wizard', id: t.id } };
          }
        }
      }
    }

    // §14.8: Priority 4: Use BFS to move toward target (enemy home if carrying treasure, else nearest treasure).
    const moves = legalActions.filter((a) => a.type === 'move');
    if (moves.length > 0) {
      let target: CellRef | null = null;
      
      // §15.5: If carrying treasure, target our own home.
      if (p.carriedTreasure !== null) {
        target = homeRef(p.color);
      } else {
        // §15.5: Find nearest enemy treasure.
        let minDist = Infinity;
        for (const color of ['blue', 'red', 'yellow', 'green'] as const) {
          const sector = state.board.sectors[color];
          for (let r = 0; r < 5; r++) {
            for (let c = 0; c < 5; c++) {
              if (sector.grid[r][c].treasures.length > 0) {
                // Only target enemy treasures
                const hasEnemyTreasure = sector.grid[r][c].treasures.some(
                  (tid) => state.treasureHome[tid] !== p.color
                );
                if (hasEnemyTreasure) {
                  const tg = toGlobal({ sector: color, r, c });
                  const myG = toGlobal(p.pos);
                  const dist = Math.abs(myG.row - tg.row) + Math.abs(myG.col - tg.col);
                  if (dist < minDist) {
                    minDist = dist;
                    target = { sector: color, r, c };
                  }
                }
              }
            }
          }
        }
      }
      
      // Use BFS to find the first step toward the target.
      if (target) {
        const firstDir = bfsFirstStep(state, p.pos, target);
        if (firstDir) {
          const moveAction = moves.find((a) => a.dir === firstDir);
          if (moveAction) return moveAction;
        }
      }
      
      // Fallback: move toward nearest enemy.
      const myGlobal = toGlobal(p.pos);
      let bestAction = moves[0];
      let bestDist = Infinity;
      for (const a of moves) {
        const d = DIR_DELTA[a.dir];
        const nr = myGlobal.row + d.dr;
        const nc = myGlobal.col + d.dc;
        for (const t of state.players) {
          if (t.id === p.id || !t.alive) continue;
          const tg = toGlobal(t.pos);
          const dist = Math.abs(nr - tg.row) + Math.abs(nc - tg.col);
          if (dist < bestDist) {
            bestDist = dist;
            bestAction = a;
          }
        }
      }
      return bestAction;
    }

    // Default: end turn.
    return { type: 'end-turn' };
  }
  
  async chooseCounter(state: GameState, pending: { cardId: string; caster: number }, myHand: string[]): Promise<{ cardId: string } | null> {
    // §16.4.4: Only counter if the card's counter.blocks matches the pending spell's type.
    const pendingCard = getCard(pending.cardId);
    if (!pendingCard) return null;
    
    for (const cardId of myHand) {
      const card = getCard(cardId);
      if (card && card.type === 'counter-spell' && card.counter) {
        // Check if this card can counter the pending spell.
        if (card.counter.blocks.includes(pendingCard.type)) {
          // Check requiresTargetingMe if specified.
          if (card.counter.requiresTargetingMe) {
            // Check if the pending spell is targeting this player.
            const caster = state.players.find(p => p.id === pending.caster);
            if (caster && pendingCard.target === 'wizard') {
              // Simplified check - assume it's targeting us for now.
              return { cardId };
            }
          } else {
            return { cardId };
          }
        }
      }
    }
    return null;
  }
}