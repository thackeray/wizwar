// AI player interface and built-in bots.

import type { GameState, Action } from '../types';
import { DIR_DELTA } from '../types';
import { getCard } from '../cards/registry';
import { adjacentRefs, hasLOS, toGlobal } from '../board';
import { currentPlayer } from '../state';

export interface AIPlayer {
  name: string;
  chooseAction(state: GameState, legalActions: Action[]): Promise<Action>;
  chooseCounter?(state: GameState, pendingSpell: { cardId: string }): Promise<Action | null>;
}

// Generate all legal actions for a player (for AI and UI).
export function getLegalActions(state: GameState, playerId: number): Action[] {
  const actions: Action[] = [];
  const p = state.players.find((pl) => pl.id === playerId)!;
  if (!p.alive || state.winner !== null) return actions;

  if (state.phase === 'move-cast') {
    // Move actions.
    if (p.mp >= 1) {
      for (const dir of ['N', 'S', 'E', 'W'] as const) {
        actions.push({ type: 'move', dir });
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
    // Cast actions.
    for (const cardId of p.hand) {
      const card = getCard(cardId);
      if (card && (card.type === 'attack-spell' || card.type === 'neutral-spell' || card.type === 'transform')) {
        actions.push({ type: 'cast', cardId });
      }
    }
    // Use item actions.
    for (const cardId of p.carriedItems) {
      actions.push({ type: 'use-item', cardId });
    }
    // End turn.
    actions.push({ type: 'end-turn' });
  } else if (state.phase === 'discard-draw') {
    // Discard actions.
    if (p.hand.length > 0) {
      actions.push({ type: 'discard', cardIds: [p.hand[0]] });
    }
    // Draw actions.
    actions.push({ type: 'draw', count: 1 });
    actions.push({ type: 'draw', count: 2 });
    // End turn.
    actions.push({ type: 'end-turn' });
  }

  return actions;
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

    // Priority 1: Punch if adjacent enemy exists.
    const punch = legalActions.find((a) => a.type === 'punch');
    if (punch) return punch;

    // Priority 2: Cast attack spells if any enemy is in LOS.
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

    // Priority 3: Move toward nearest enemy using global coords.
    const moves = legalActions.filter((a) => a.type === 'move');
    if (moves.length > 0) {
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
}