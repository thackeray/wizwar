// StrategicBot: a proper Wiz-War AI focused on actually winning.
//
// Design notes (from real-game diagnostics):
//  - The game is won at 2 VP: deliver enemy treasures to your own home, or kill.
//  - Delivery must be UNINTERRUPTED once a treasure is carried: run home, don't
//    punch/cast/wander. Never fall back to "move toward nearest enemy".
//  - Acquisition is the bottleneck (diagnostics: 4 pickups / 200 turns). Actively
//    chase the nearest REACHABLE enemy treasure; use energy cards to boost speed.
//  - Combat finishing breaks 1-1-1-1 stalemates: kill weakened enemies, steal
//    treasure from adjacent carriers.
//  - Locked doors block BFS; unlock them (pick-lock / master key) when they block
//    the route home.

import type { GameState, Action, PlayerState, CellRef, Dir, Color } from '../types';
import { getCard } from '../cards/registry';
import { getCell, hasLOS, toGlobal, moveDestination } from '../board';
import { currentPlayer, homeRef } from '../state';
import { bfsFirstStep, type AIPlayer } from './bots';

export interface StrategicWeights {
  treasureSeek: number;      // 0-1: how hard to chase treasure
  deliverySpeed: number;     // 0-1: how aggressively to boost + run home
  combatFinish: number;      // 0-1: how aggressively to finish weak enemies
  selfPreserve: number;      // 0-1: how hard to flee when threatened
  unlockDoors: number;       // 0-1: how eagerly to spend actions unlocking doors
  // Per-sector treasure preference (0-1). Breaks homogeneity: distinct bots
  // contest different treasures instead of all racing the same one.
  preferBlue?: number;
  preferRed?: number;
  preferYellow?: number;
  preferGreen?: number;
}

export const DEFAULT_STRATEGIC: StrategicWeights = {
  treasureSeek: 0.9,
  deliverySpeed: 0.8,
  combatFinish: 0.7,
  selfPreserve: 0.6,
  unlockDoors: 0.7,
  preferBlue: 0,
  preferRed: 0,
  preferYellow: 0,
  preferGreen: 0,
};

function cellOf(state: GameState, ref: CellRef) {
  return getCell(state.board, ref);
}

// Greedy first step toward a target using global Manhattan distance (no BFS).
// Used as a fallback when BFS finds no path (should be rare).
function greedyStep(state: GameState, from: CellRef, to: CellRef): Dir | null {
  const g1 = toGlobal(from);
  const g2 = toGlobal(to);
  const candidates: { dir: Dir; dist: number }[] = [];
  for (const dir of ['N', 'S', 'E', 'W'] as Dir[]) {
    const dest = moveDestination(state.board, from, dir, from.sector as Color);
    if (!dest) continue;
    const d = toGlobal(dest);
    const dist = Math.abs(d.row - g2.row) + Math.abs(d.col - g2.col);
    candidates.push({ dir, dist });
  }
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates.length > 0 && candidates[0].dist < Math.abs(g1.row - g2.row) + Math.abs(g1.col - g2.col)
    ? candidates[0].dir
    : null;
}

function manhattan(a: CellRef, b: CellRef): number {
  const g1 = toGlobal(a), g2 = toGlobal(b);
  return Math.abs(g1.row - g2.row) + Math.abs(g1.col - g2.col);
}

// Adjacent enemy wizards (excluding dead).
function adjacentEnemies(state: GameState, p: PlayerState): PlayerState[] {
  return state.players.filter((e) => e.id !== p.id && e.alive && manhattan(e.pos, p.pos) === 1);
}

// Whether a door exists on the given side of a cell and is locked/blocking for us.
function blockedDoorAt(state: GameState, ref: CellRef, dir: Dir, color: Color): boolean {
  const cell = cellOf(state, ref);
  const door = cell.doors[dir];
  if (!door || door.destroyed) return false;
  return door.locked && door.color !== color && door.heldOpenBy === null;
}

export class StrategicBot implements AIPlayer {
  name: string;
  weights: StrategicWeights;

  constructor(name = 'Strategic Bot', weights?: Partial<StrategicWeights>) {
    this.name = name;
    this.weights = { ...DEFAULT_STRATEGIC, ...(weights ?? {}) };
  }

  async chooseAction(state: GameState, legal: Action[]): Promise<Action> {
    const p = currentPlayer(state);

    if (state.phase === 'discard-draw') {
      const draw = legal.find((a) => a.type === 'draw' && a.count === 2);
      if (draw) return draw;
      return { type: 'end-turn' };
    }

    const home = homeRef(p.color);
    const carrying = p.carriedTreasure !== null;
    const myCell = cellOf(state, p.pos);

    // ---------- CARRYING: deliver home, no detours ----------
    if (carrying) {
      // 1. On our own home square -> drop and score.
      if (myCell.kind === 'home' && p.pos.sector === p.color) {
        const drop = legal.find((a) => a.type === 'drop-treasure');
        if (drop) return drop;
      }
      // 2. Boost speed if we have an energy card and are far from home.
      if (!p.speedBoosted && this.weights.deliverySpeed > 0.4) {
        const energyCard = p.hand.find((c) => (getCard(c)?.energyValue ?? 0) > 0);
        if (energyCard) {
          const boost = legal.find((a) => a.type === 'boost-speed' && a.cardId === energyCard);
          if (boost) return boost;
        }
      }
      // 3. Teleport toward home to shortcut delivery (free action, doesn't
      //    consume MP).
      if (this.weights.deliverySpeed > 0.4) {
        const tele = this.bestUtilityMoveSpell(state, p, legal, home);
        if (tele) return tele;
      }
      // 4. Move toward home (BFS). If blocked by a door, unlock it.
      const step = bfsFirstStep(state, p.pos, home);
      if (step) {
        const mv = legal.find((a) => a.type === 'move' && a.dir === step);
        if (mv) return mv;
      }
      // 4. Unlock a door blocking the route home.
      if (this.weights.unlockDoors > 0.4) {
        const unlock = this.findUnlockAction(state, p, legal, home);
        if (unlock) return unlock;
      }
      // 5. Greedy fallback toward home (never toward enemies).
      const gstep = greedyStep(state, p.pos, home);
      if (gstep) {
        const mv = legal.find((a) => a.type === 'move' && a.dir === gstep);
        if (mv) return mv;
      }
      // 6. Absolutely nothing else: pass.
      return { type: 'end-turn' };
    }

    // ---------- NOT CARRYING ----------
    // 1. Pick up an enemy treasure on our square — but NEVER a treasure already
    //    banked in our own home (would re-pick/drop and churn VP, §15.6).
    const bankedHere = myCell.kind === 'home' && p.pos.sector === p.color;
    if (!bankedHere && myCell.treasures.some((t) => state.treasureHome[t] !== p.color)) {
      const tId = myCell.treasures.find((t) => state.treasureHome[t] !== p.color)!;
      const pick = legal.find((a) => a.type === 'pick-up-treasure' && a.treasureId === tId);
      if (pick) return pick;
    }

    const enemies = state.players.filter((e) => e.id !== p.id && e.alive);
    const adj = adjacentEnemies(state, p);
    const target = this.nearestReachableTreasure(state, p);

    // 2. Cast a damage spell / throw a weapon at an enemy in LOS. Casting is a
    //    FREE action (doesn't consume MP), so do it before moving — ranged
    //    damage while closing in on treasure.
    if (this.weights.combatFinish > 0.3) {
      const cast = this.bestAttackSpell(state, p, legal);
      if (cast) return cast;
      const weapon = this.bestWeaponAttack(state, p, legal);
      if (weapon) return weapon;
    }

    // 3. Combat. Punch a weakened enemy, steal a carried treasure, or punch any
    //    adjacent enemy when we're clearly healthier (creates kills → VP).
    if (this.weights.combatFinish > 0.3 && adj.length > 0) {
      const threat = adj.find((e) => e.life <= 6 || e.carriedTreasure !== null || (p.life >= e.life + 6));
      if (threat) {
        const punch = legal.find((a) => a.type === 'punch' && a.target === threat.id);
        if (punch) return punch;
      }
    }

    // 4. Flee if in danger and healthy enemies loom.
    if (this.weights.selfPreserve > 0.3 && p.life <= 6 && adj.length > 0) {
      const flee = this.findFleeAction(state, p, legal, adj[0]);
      if (flee) return flee;
    }

    // 5. Cast a movement utility spell (teleport/windrider) to shortcut toward
    //    the treasure — visible card use while traveling.
    if (target) {
      const tele = this.bestUtilityMoveSpell(state, p, legal, target);
      if (tele) return tele;
    }

    // 6. Chase the nearest REACHABLE enemy treasure.
    if (target) {
      const step = bfsFirstStep(state, p.pos, target);
      if (step) {
        const mv = legal.find((a) => a.type === 'move' && a.dir === step);
        if (mv) return mv;
      }
      if (this.weights.unlockDoors > 0.4) {
        const unlock = this.findUnlockAction(state, p, legal, target);
        if (unlock) return unlock;
      }
    }

    // (Boost while chasing is handled above; don't boost idly.)

    // 7. Explore: move toward the closest enemy (any) — or nearest treasure.
    if (target) {
      const gstep = greedyStep(state, p.pos, target);
      if (gstep) {
        const mv = legal.find((a) => a.type === 'move' && a.dir === gstep);
        if (mv) return mv;
      }
    }
    const nearestEnemy = enemies.sort((a, b) => manhattan(a.pos, p.pos) - manhattan(b.pos, p.pos))[0];
    if (nearestEnemy) {
      const gstep = greedyStep(state, p.pos, nearestEnemy.pos);
      if (gstep) {
        const mv = legal.find((a) => a.type === 'move' && a.dir === gstep);
        if (mv) return mv;
      }
    }

    return { type: 'end-turn' };
  }

  // Nearest enemy treasure with a real BFS path (distance > 0).
  // `prefer*` weights bias toward/against specific sectors' treasures.
  private nearestReachableTreasure(state: GameState, p: PlayerState): CellRef | null {
    let best: CellRef | null = null;
    let bestDist = Infinity;
    for (const color of ['blue', 'red', 'yellow', 'green'] as Color[]) {
      const sector = state.board.sectors[color];
      const bias = (this.weights[`prefer${color[0].toUpperCase()}${color.slice(1)}` as keyof StrategicWeights] ?? 0) as number;
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          const cell = sector.grid[r][c];
          if (!cell.treasures.some((t) => state.treasureHome[t] !== p.color)) continue;
          const ref: CellRef = { sector: color, r, c };
          // Skip treasures already banked in our home (already scored).
          if (cell.kind === 'home' && color === p.color) continue;
          const step = bfsFirstStep(state, p.pos, ref);
          if (!step) continue; // unreachable -> skip
          // Small rng jitter breaks homogeneity: identical bots otherwise all
          // race the same treasure and deadlock into a seat-dependent race.
          const d = manhattan(p.pos, ref) - bias * 8 - state.rng.next() * 3;
          if (d < bestDist) {
            bestDist = d;
            best = ref;
          }
        }
      }
    }
    return best;
  }

  // Find a pick-lock cast or master-key use that unlocks a door blocking the route.
  private findUnlockAction(state: GameState, p: PlayerState, legal: Action[], _toward: CellRef): Action | null {
    // Try to unlock a door adjacent to us that stands between us and `toward`.
    for (const dir of ['N', 'S', 'E', 'W'] as Dir[]) {
      if (!blockedDoorAt(state, p.pos, dir, p.color)) continue;
      const ref = { ...p.pos, side: dir };
      const cast = legal.find((a): a is Extract<Action, { type: 'cast' }> =>
        a.type === 'cast' && (getCard(a.cardId)?.effect.op === 'pick-lock'));
      if (cast) return { type: 'cast', cardId: cast.cardId, target: { kind: 'door', ref } };
      const item = legal.find((a): a is Extract<Action, { type: 'use-item' }> =>
        a.type === 'use-item' && getCard(a.cardId)?.id === 'thaumaturgy-master-key');
      if (item) return { type: 'use-item', cardId: item.cardId, target: { kind: 'door', ref } };
    }
    return null;
  }

  // Best attack spell to cast at a worthy target (weakened or treasure-carrier) in LOS.
  private bestAttackSpell(state: GameState, p: PlayerState, legal: Action[]): Action | null {
    let bestAction: Action | null = null;
    let bestScore = 0;
    // Only cast when reasonably healthy — don't spend our turn when death is near.
    if (p.life < 8) return null;
    for (const a of legal) {
      if (a.type !== 'cast') continue;
      const card = getCard(a.cardId);
      // Only cast spells that actually deal damage. Many "attack-spell" cards in
      // the data are really utility spells (Pick Lock, Add, Create Wall...) — see
      // IMPLEMENTATION_PLAN §18; casting them would waste our one attack.
      if (!card || card.type !== 'attack-spell') continue;
      if (card.effect.op !== 'damage') continue;
      // Score targets: weakest enemy in LOS is the best target.
      for (const t of state.players) {
        if (t.id === p.id || !t.alive) continue;
        if (!hasLOS(state.board, p.pos, t.pos, p.color)) continue;
        let score = (20 - t.life); // prefer weaker
        if (t.carriedTreasure !== null) score += 8; // steal a delivery
        if (manhattan(t.pos, p.pos) <= 3) score += 3;
        if (score > bestScore) {
          bestScore = score;
          bestAction = { type: 'cast', cardId: a.cardId, target: { kind: 'wizard', id: t.id } };
        }
      }
    }
    return bestAction;
  }

  // Throw an offensive item (weapon) at a worthy target in LOS. Items may come
  // from hand or carriedItems (§21).
  private bestWeaponAttack(state: GameState, p: PlayerState, legal: Action[]): Action | null {
    let bestAction: Action | null = null;
    let bestScore = 0;
    if (p.life < 8) return null;
    for (const a of legal) {
      if (a.type !== 'use-item') continue;
      const card = getCard(a.cardId);
      if (!card || card.effect.op !== 'item') continue;
      // Offensive throwables.
      const offensive = /boomstone|large-rock|stone-spikes|wizardblade/.test(card.id);
      if (!offensive) continue;
      for (const t of state.players) {
        if (t.id === p.id || !t.alive) continue;
        if (!hasLOS(state.board, p.pos, t.pos, p.color)) continue;
        let score = (20 - t.life);
        if (t.carriedTreasure !== null) score += 8;
        if (score > bestScore) {
          bestScore = score;
          bestAction = { type: 'use-item', cardId: a.cardId, target: { kind: 'wizard', id: t.id } };
        }
      }
    }
    return bestAction;
  }

  // Cast a movement spell (windrider / teleport) to shortcut toward `goal`.
  // Casting is free (no MP), so it's pure value while traveling.
  private bestUtilityMoveSpell(state: GameState, p: PlayerState, legal: Action[], goal: CellRef): Action | null {
    void state;
    if (manhattan(p.pos, goal) <= 2) return null; // already close, no need
    const g1 = toGlobal(p.pos);
    const g2 = toGlobal(goal);

    for (const a of legal) {
      if (a.type !== 'cast') continue;
      const card = getCard(a.cardId);
      if (!card) continue;
      // Windrider: move in a straight line toward the goal.
      if (card.effect.op === 'move-line' && a.target?.kind === 'cell') {
        // Prefer a cell that keeps us moving toward the goal.
        const t = a.target as { kind: 'cell'; ref: CellRef };
        const g = toGlobal(t.ref);
        const better = Math.abs(g.row - g2.row) + Math.abs(g.col - g2.col) < Math.abs(g1.row - g2.row) + Math.abs(g1.col - g2.col);
        if (better) return { type: 'cast', cardId: a.cardId, target: a.target };
      }
      // Teleport: jump toward the goal.
      if (card.effect.op === 'teleport' && a.target?.kind === 'cell') {
        return { type: 'cast', cardId: a.cardId, target: a.target };
      }
    }
    return null;
  }

  // Move away from the nearest enemy (simple greedy).
  private findFleeAction(_state: GameState, p: PlayerState, legal: Action[], enemy: PlayerState): Action | null {
    const g = toGlobal(p.pos);
    const eg = toGlobal(enemy.pos);
    const away: Dir[] = [];
    if (eg.row < g.row) away.push('S');
    if (eg.row > g.row) away.push('N');
    if (eg.col < g.col) away.push('E');
    if (eg.col > g.col) away.push('W');
    for (const dir of away) {
      const mv = legal.find((a) => a.type === 'move' && a.dir === dir);
      if (mv) return mv;
    }
    return null;
  }
}
