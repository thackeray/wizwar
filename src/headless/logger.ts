// Match logging: save full game logs and AI decisions to disk for analysis/training.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { currentPlayer } from '../core/state';
import type { GameState, Action } from '../core/types';
import type { AIPlayer } from '../core/ai/bots';

export interface MatchMeta {
  seed: number;
  botTypes: string[];
  playerColors: string[];
  winner: number | null;
  turns: number;
  maxTurns: number;
  schools: string[];
  timestamp?: string;
}

// Serialize a finished match to JSON: metadata + full event log + final state.
export function matchLogJSON(state: GameState, meta: MatchMeta): Record<string, unknown> {
  return {
    meta,
    players: state.players.map((p) => ({
      color: p.color, vp: p.vp, life: p.life, alive: p.alive,
      pos: p.pos, carrying: p.carriedTreasure !== null,
    })),
    log: state.log.map((l) => ({ turn: l.turn, playerId: l.playerId, text: l.text })),
  };
}

// Human-readable text log (same shape the CLI already prints, but complete).
export function matchLogText(state: GameState, meta: MatchMeta): string {
  const lines: string[] = [];
  lines.push(`== Match: seed=${meta.seed} bots=${meta.botTypes.join(',')} maxTurns=${meta.maxTurns}`);
  lines.push(`Winner: ${meta.winner === null ? 'None (max turns)' : state.players[meta.winner].color} (turns=${meta.turns})`);
  lines.push(`Final: ${state.players.map((p) => `${p.color} vp${p.vp} life${p.life}${p.alive ? '' : ' DEAD'}`).join(' | ')}`);
  lines.push('---');
  for (const l of state.log) lines.push(`T${l.turn} ${l.text}`);
  return lines.join('\n');
}

export function saveMatchLog(state: GameState, meta: MatchMeta, filepath: string): void {
  mkdirSync(dirname(filepath), { recursive: true });
  writeFileSync(filepath, JSON.stringify(matchLogJSON(state, meta), null, 2));
}

export function saveMatchText(state: GameState, meta: MatchMeta, filepath: string): void {
  mkdirSync(dirname(filepath), { recursive: true });
  writeFileSync(filepath, matchLogText(state, meta));
}

// A decision record: one per chooseAction call.
export interface DecisionRecord {
  turn: number;
  player: number; // color index
  color: string;
  phase: string;
  pos: { sector: string; r: number; c: number };
  mp: number;
  life: number;
  vp: number;
  carrying: boolean;
  action: string; // e.g. "move:N", "cast:zot@target:wizard:1"
  legalCount: number;
}

// Wraps any bot and records every decision it makes, plus its context.
export class LoggingBot implements AIPlayer {
  name: string;
  decisions: DecisionRecord[] = [];
  private inner: AIPlayer;

  constructor(inner: AIPlayer, _colors: string[]) {
    this.name = inner.name;
    this.inner = inner;
  }

  async chooseAction(state: GameState, legal: Action[]): Promise<Action> {
    const p = currentPlayer(state);
    const a = await this.inner.chooseAction(state, legal);
    const actionStr = describeAction(a);
    this.decisions.push({
      turn: state.turnNumber,
      player: p.id,
      color: p.color,
      phase: state.phase,
      pos: { ...p.pos },
      mp: p.mp,
      life: p.life,
      vp: p.vp,
      carrying: p.carriedTreasure !== null,
      action: actionStr,
      legalCount: legal.length,
    });
    return a;
  }
}

function describeAction(a: Action): string {
  switch (a.type) {
    case 'move': return `move:${a.dir}`;
    case 'punch': return `punch:${a.target}`;
    case 'cast': {
      const t = a.target ? `@${a.target.kind}:${(a.target as { id?: number }).id ?? ''}` : '';
      return `cast:${a.cardId}${t}`;
    }
    case 'use-item': return `use-item:${a.cardId}`;
    case 'attack-object': return `attack-object:${a.target.kind}`;
    case 'pick-up-treasure': return `pick-up-treasure:${a.treasureId}`;
    case 'drop-treasure': return `drop-treasure`;
    case 'pick-up-object': return `pick-up-object:${a.objectId}`;
    case 'drop-item': return `drop-item:${a.cardId}`;
    case 'boost-speed': return `boost-speed:${a.cardId}`;
    case 'end-spell': return `end-spell:${a.index}`;
    case 'discard': return `discard:${a.cardIds.join(',')}`;
    case 'draw': return `draw:${a.count}`;
    case 'end-turn': return `end-turn`;
    default: return a.type;
  }
}

// Save all logged decisions across bots to one JSON file.
export function saveDecisions(bots: LoggingBot[], meta: MatchMeta, filepath: string): void {
  mkdirSync(dirname(filepath), { recursive: true });
  const out = {
    meta,
    decisions: bots.map((b, i) => ({
      bot: b.name,
      seat: meta.playerColors[i],
      records: b.decisions,
    })),
  };
  writeFileSync(filepath, JSON.stringify(out, null, 2));
}
