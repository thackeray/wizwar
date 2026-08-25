// Battle screen: drives a real game via runBattle, renders the board / panels /
// hand / log, handles human input (HumanBot), counter prompts, damage floaters.
import { useEffect, useReducer, useRef, useState } from 'react';
import { loadBuiltInCards } from '../../core/cards';
import { buildDeck, getCard } from '../../core/cards/registry';
import { createGameState } from '../../core/state';
import { createBoardFromTopology, moveDestination, toGlobal } from '../../core/board';
import { convertBoardData } from '../../core/board-data';
import { startTurn } from '../../core/turn';
import { HeuristicBot, RandomBot, type AIPlayer } from '../../core/ai/bots';
import { StrategicBot } from '../../core/ai/strategic';
import { EvolvingBot } from '../../core/ai/evolving';
import { runBattle } from '../../headless/run-game';
import { HumanBot, type PendingCounter } from '../battle/human-bot';
import Board, { type BoardProps } from './Board';
import PlayerPanel from './PlayerPanel';
import Hand from './Hand';
import LogPanel from './LogPanel';
import boardDataJSON from '../../board-data.json';
import type { GameState, Action, CellRef, Color, PlayerState } from '../../core/types';

export interface BattleConfig {
  playerCount: number;
  botTypes: ('random' | 'heuristic' | 'strategic' | 'human')[];
  schools: string[];
  speed: 'slow' | 'medium' | 'fast' | 'instant';
  seed: number;
}

function makeBot(type: string, i: number): AIPlayer {
  switch (type) {
    case 'random': return new RandomBot();
    case 'heuristic': return new HeuristicBot();
    case 'evolving': return new EvolvingBot(`Bot ${i}`);
    case 'human': return new HumanBot();
    default: return new StrategicBot(`Bot ${i}`);
  }
}

function delayForSpeed(speed: string): number {
  switch (speed) {
    case 'slow': return 600;
    case 'medium': return 300;
    case 'fast': return 90;
    default: return 0;
  }
}

function cellKey(ref: CellRef): string {
  return `${ref.sector}:${ref.r}:${ref.c}`;
}

function describeAction(state: GameState, a: Action): string {
  switch (a.type) {
    case 'punch': return `Punch ${state.players[a.target].color}`;
    case 'boost-speed': {
      const fuel = getCard(a.cardId);
      return fuel ? `Boost Speed (+${fuel.energyValue} Energy)` : 'Boost Speed';
    }
    case 'end-turn': return 'End Turn';
    case 'pick-up-treasure': return 'Pick up Treasure';
    case 'drop-treasure': return 'Drop Treasure';
    case 'pick-up-object': return 'Pick up Object';
    case 'drop-item': return `Drop ${a.cardId}`;
    case 'use-item': return `Use ${a.cardId}`;
    case 'discard': return `Discard`;
    case 'draw': return `Draw ${a.count}`;
    case 'cast': {
      const card = getCard(a.cardId);
      return `Cast ${card?.name ?? a.cardId}${a.target ? ` @${a.target.kind}` : ''}`;
    }
    default: return a.type;
  }
}

interface Floater {
  id: number;
  x: number; // % in board box
  y: number;
  text: string;
  cls: string;
}

export default function BattleScreen({ config, onExit }: { config: BattleConfig; onExit: () => void }) {
  const stateRef = useRef<GameState | null>(null);
  const botsRef = useRef<AIPlayer[]>([]);
  const humanRef = useRef<HumanBot | null>(null);
  const prevLivesRef = useRef<number[]>([]);
  const prevVpRef = useRef<number[]>([]);
  const floaterIdRef = useRef(0);
  const boardBoxRef = useRef<HTMLDivElement | null>(null);
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [gameOver, setGameOver] = useState<GameState | null>(null);

  const state = stateRef.current;
  const human = humanRef.current;
  const pendingAction = human?.pendingAction ?? null;
  const pendingCounter = human?.pendingCounter ?? null;

  useEffect(() => {
    let cancelled = false;
    loadBuiltInCards();
    const board = createBoardFromTopology(convertBoardData(boardDataJSON as any));
    // Cantrip is always in the deck (Wiz-War base school).
    const deck = buildDeck(['cantrip', ...config.schools]);
    const colors = ['blue', 'red', 'yellow', 'green'].slice(0, config.playerCount) as Color[];
    const s = createGameState(
      { seed: config.seed, playerColors: colors, botSeats: colors.map(() => true), schools: config.schools as any, cantripSchool: 'cantrip' },
      board, deck,
    );
    stateRef.current = s;
    prevLivesRef.current = s.players.map((p) => p.life);
    prevVpRef.current = s.players.map((p) => p.vp);

    const humanBot = new HumanBot();
    humanBot.onChange = () => { if (!cancelled) force(); };
    humanRef.current = humanBot;
    // Human seats reuse the SAME instance the UI reads (humanRef), so its
    // pendingAction surfaces to React.
    botsRef.current = colors.map((_, i) =>
      config.botTypes[i] === 'human' ? humanBot : makeBot(config.botTypes[i] ?? 'strategic', i),
    );

    startTurn(s);
    force();

    (async () => {
      try {
      await runBattle(s, botsRef.current, {
        seed: config.seed,
        playerColors: colors,
        botTypes: config.botTypes as any,
        schools: config.schools as any,
        maxTurns: 500,
        callbacks: {
          afterAction: async (st) => {
            if (cancelled) return;
            detectFloaters(st);
            if (st.winner !== null) setGameOver(st);
            force();
            const d = delayForSpeed(config.speed);
            if (d > 0) await new Promise((r) => setTimeout(r, d));
          },
        },
      });
      } catch (e) { console.error('Battle run error:', e); }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function detectFloaters(st: GameState): void {
    const lives = prevLivesRef.current;
    const vps = prevVpRef.current;
    const adds: Floater[] = [];
    st.players.forEach((p, i) => {
      if (!p.alive) return;
      const g = toGlobal(p.pos);
      const x = g.col * 10 + 5;
      const y = g.row * 10 + 5;
      if (lives[i] !== undefined && p.life < lives[i]) {
        adds.push({ id: floaterIdRef.current++, x, y, text: `-${lives[i] - p.life}`, cls: 'vfx-float--dmg' });
      }
      if (vps[i] !== undefined && p.vp > vps[i]) {
        adds.push({ id: floaterIdRef.current++, x, y, text: `+${p.vp - vps[i]} VP`, cls: 'vfx-float--vp' });
      }
    });
    prevLivesRef.current = st.players.map((p) => p.life);
    prevVpRef.current = st.players.map((p) => p.vp);
    if (adds.length > 0) {
      setFloaters((f) => [...f, ...adds]);
      adds.forEach((fl) => setTimeout(() => setFloaters((f) => f.filter((x) => x.id !== fl.id)), 950));
    }
  }

  // Human highlight computation.
  let moveByCell = new Map<string, Action>();
  let castByCell = new Map<string, Action>();
  let buttons: Action[] = [];
  let humanPlayer: PlayerState | null = null;
  if (pendingAction) {
    humanPlayer = pendingAction.state.players[pendingAction.state.currentPlayer];
    const p = humanPlayer;
    for (const a of pendingAction.legal) {
      if (a.type === 'move') {
        const dest = moveDestination(pendingAction.state.board, p.pos, a.dir, p.color);
        if (dest) moveByCell.set(cellKey(dest), a);
      } else if (a.type === 'cast' && a.cardId === selectedCard) {
        if (a.target && a.target.kind === 'cell') {
          castByCell.set(cellKey(a.target.ref), a);
        } else if (a.target && a.target.kind === 'wizard') {
          const t = pendingAction.state.players[a.target.id];
          if (t && t.alive) castByCell.set(cellKey(t.pos), a);
        } else if (a.target && (a.target.kind === 'door' || a.target.kind === 'wall')) {
          castByCell.set(cellKey(a.target.ref), a);
        } else if (!a.target) {
          buttons.push(a);
        }
      } else if (a.type === 'punch' || a.type === 'boost-speed' || a.type === 'end-turn' ||
                 a.type === 'pick-up-treasure' || a.type === 'drop-treasure' || a.type === 'use-item' ||
                 a.type === 'pick-up-object' || a.type === 'draw' || a.type === 'discard') {
        buttons.push(a);
      }
    }
  }

  const boardHighlight: CellRef[] = [];
  const boardCastTargets: CellRef[] = [];
  if (selectedCard) {
    boardCastTargets.push(...[...castByCell.keys()].map(parseKey));
  } else {
    boardHighlight.push(...[...moveByCell.keys()].map(parseKey));
  }

  function parseKey(k: string): CellRef {
    const [sector, r, c] = k.split(':');
    return { sector: sector as CellRef['sector'], r: Number(r), c: Number(c) };
  }

  function onCellClick(ref: CellRef): void {
    const bot = humanRef.current;
    if (!bot || !bot.pendingAction) return;
    const key = cellKey(ref);
    if (selectedCard) {
      const act = castByCell.get(key);
      if (act) { bot.submitAction(act); setSelectedCard(null); }
    } else {
      const act = moveByCell.get(key);
      if (act) bot.submitAction(act);
    }
  }

  function onCardClick(cardId: string): void {
    setSelectedCard((c) => (c === cardId ? null : cardId));
  }

  const boardProps: BoardProps = {
    state: state!,
    highlight: boardHighlight,
    castTargets: boardCastTargets,
    onCellClick,
    interactive: !!pendingAction,
  };

  return (
    <div className="battle">
      <header className="battle-header">
        <h1 className="battle-title">Wiz-War</h1>
        <div className="battle-meta">
          {state && (
            <>
              <span>Turn {state.turnNumber}</span>
              <span className={`phase-chip phase-chip--${state.phase}`}>{state.phase}</span>
              {pendingAction && <span className="phase-chip" style={{ background: '#059669' }}>Your turn</span>}
            </>
          )}
          <button className="battle-btn" onClick={onExit}>Exit</button>
        </div>
      </header>

      <div className="battle-main">
        {pendingAction && (
          <div className="turn-callout">
            <span className="turn-callout-title">▶ YOUR TURN</span>
            <span className="turn-callout-hint">
              Click a <b>glowing cyan cell</b> to move · pick a card to cast · or press <b>End Turn</b>
            </span>
          </div>
        )}
        <div className="battle-board" ref={boardBoxRef}>
          {state && <Board {...boardProps} />}
          <div className="vfx-float-layer" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 30 }}>
            {floaters.map((f) => (
              <span key={f.id} className={`vfx-float ${f.cls}`} style={{ left: `${f.x}%`, top: `${f.y}%` }}>
                {f.text}
              </span>
            ))}
          </div>
        </div>

        <div className="battle-sidebar">
          {state && (
            <div className="player-panels">
              {state.players.map((p) => (
                <PlayerPanel key={p.id} player={p} isTurn={p.id === state.currentPlayer} isCurrent={false} />
              ))}
            </div>
          )}

          {state && (
            <Hand
              cards={state.players[state.currentPlayer].hand}
              selected={selectedCard}
              onCardClick={pendingAction ? onCardClick : () => {}}
              label={`${state.players[state.currentPlayer].color} Wizard's Hand${pendingAction ? ' (You)' : ''}${pendingAction ? ' — pick a card to cast, or click a highlighted cell to move' : ''}`}
            />
          )}

          {pendingAction && (
            <div className="hand" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {buttons.map((a, i) => (
                <button key={i} className="battle-btn" onClick={() => human!.submitAction(a)}>
                  {describeAction(state!, a)}
                </button>
              ))}
            </div>
          )}

          {state && <LogPanel state={state} />}
        </div>
      </div>

      {pendingCounter && state && <CounterPrompt counter={pendingCounter} onPick={(id) => human!.submitCounter(id)} onPass={() => human!.submitCounter(null)} />}

      {gameOver && gameOver.winner !== null && (
        <div className="vfx-banner">
          🏆 {gameOver.players[gameOver.winner].color} Wizard wins!
        </div>
      )}
    </div>
  );
}

function CounterPrompt({ counter, onPick, onPass }: {
  counter: PendingCounter;
  onPick: (cardId: string) => void;
  onPass: () => void;
}) {
  const castCard = getCard(counter.pending.cardId);
  const casterColor = counter.state.players[counter.pending.caster].color;
  const canCounter = counter.myHand.filter((id) => {
    const c = getCard(id);
    if (!c || !c.counter) return false;
    if (!castCard) return false;
    if (!c.counter.blocks.includes(castCard.type)) return false;
    if (c.counter.requiresTargetingMe) {
      const t = counter.state.awaitingCast?.target;
      if (!t || t.kind !== 'wizard' || t.id !== counter.state.currentPlayer) return false;
    }
    return true;
  });

  return (
    <div className="vfx-banner vfx-banner--counter" style={{ display: 'block', textAlign: 'center' }}>
      <div style={{ marginBottom: 8 }}>⚔️ {casterColor} casts <b>{castCard?.name ?? counter.pending.cardId}</b> — counter?</div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        {canCounter.map((id) => (
          <button key={id} className="battle-btn" style={{ background: '#7c3aed' }} onClick={() => onPick(id)}>
            Counter: {getCard(id)?.name}
          </button>
        ))}
        <button className="battle-btn" onClick={onPass}>Pass</button>
      </div>
    </div>
  );
}
