// Unified battle driver for AI vs AI games.

import type { GameState, Color } from '../core/types';
import { applyAction } from '../core/actions';
import { startTurn } from '../core/turn';
import { getLegalActions, AIPlayer } from '../core/ai/bots';

export interface BattleCallbacks {
  afterAction?(state: GameState): void | Promise<void>;
  onWinner?(state: GameState): void | Promise<void>;
}

export interface BattleConfig {
  seed: number;
  playerColors: Color[];
  botTypes: string[]; // 'random' | 'heuristic' | 'evolving' | custom
  schools: string[];
  maxTurns?: number; // default 500
  delayMs?: number; // UI use; headless pass 0
  callbacks?: BattleCallbacks;
}

export interface BattleResult {
  winner: number | null;
  turns: number;
}

const MAX_GUARD = 100;

export async function runBattle(
  state: GameState,
  bots: AIPlayer[],
  cfg: BattleConfig,
): Promise<BattleResult> {
  const maxTurns = cfg.maxTurns ?? 500;
  let turns = 0;

  while (state.winner === null && turns < maxTurns) {
    const cur = state.players[state.currentPlayer];
    
    // Start the turn if we're not already in one.
    if (state.phase !== 'move-cast' && state.phase !== 'discard-draw') {
      startTurn(state);
      if (state.winner !== null || !cur.alive) continue;
    }
    
    
    
    let guard = 0;
    let turnAdvanced = false;
    let failCount = 0;
    while (
      (state.phase === 'move-cast' || state.phase === 'discard-draw') &&
      state.currentPlayer === cur.id &&
      guard++ < MAX_GUARD
    ) {
      const legal = getLegalActions(state, cur.id);
      if (legal.length === 0) {
        applyAction(state, { type: 'end-turn' });
        turnAdvanced = true;
        break;
      }
      
      const bot = bots[cur.id] ?? bots[0];
      const action = await bot.chooseAction(state, legal);
      const res = applyAction(state, action);
      
      // If cast was successful and awaiting counter, run counter window.
      if (res.ok && state.awaitingCast) {
        await runCounterWindow(state, bots, cur.id);
      }
      
      await cfg.callbacks?.afterAction?.(state);
      
      if (res.ok && state.currentPlayer !== cur.id) {
        turnAdvanced = true;
        break;
      }
      
      // If action failed, increment failCount.
      if (!res.ok) {
        failCount++;
        // If too many failures, force end-turn to avoid infinite loop.
        if (failCount > 3) {
          applyAction(state, { type: 'end-turn' });
          turnAdvanced = true;
          break;
        }
      } else {
        // Reset failCount on success.
        failCount = 0;
      }
    }
    
    // If we hit MAX_GUARD without advancing the turn, force an end-turn.
    if (!turnAdvanced && state.currentPlayer === cur.id) {
      applyAction(state, { type: 'end-turn' });
    }
    
    turns++;
  }
  
  if (state.winner !== null) {
    await cfg.callbacks?.onWinner?.(state);
  }
  
  return { winner: state.winner, turns };
}

// Run the counter window for a pending cast.
async function runCounterWindow(
  state: GameState,
  bots: AIPlayer[],
  casterId: number,
): Promise<void> {
  if (!state.awaitingCast) return;
  
  const { counterOrder, countered } = state.awaitingCast;
  
  if (countered) return;
  
  // If no eligible counters, resolve immediately.
  if (counterOrder.length === 0) {
    applyAction(state, { type: 'resolve-cast' });
    return;
  }
  
  // For each player in counter order, ask if they want to counter.
  for (const playerId of counterOrder) {
    const player = state.players.find((p) => p.id === playerId);
    if (!player || !player.alive) continue;
    
    const bot = bots[playerId] ?? bots[0];
    if (!bot.chooseCounter) continue;
    
    const choice = await bot.chooseCounter(state, {
      cardId: state.awaitingCast!.cardId,
      caster: casterId,
    }, player.hand);
    
    if (choice) {
      const res = applyAction(state, { type: 'counter', cardId: choice.cardId, playerId });
      if (res.ok) {
        // Counter successful, break and skip resolve.
        break;
      }
      // Counter failed, continue to next player.
    }
  }
  
  // If not countered, resolve the cast.
  if (state.awaitingCast && !state.awaitingCast.countered) {
    applyAction(state, { type: 'resolve-cast' });
  }
}