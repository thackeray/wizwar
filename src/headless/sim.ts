// Headless game runner: AI vs AI full game simulation (thin wrapper around runBattle).

import { createBoardFromTopology } from '../core/board';
import { convertBoardData } from '../core/board-data';
import { createGameState } from '../core/state';
import { loadBuiltInCards } from '../core/cards';
import { buildDeck } from '../core/cards/registry';
import { HeuristicBot, RandomBot, type AIPlayer } from '../core/ai/bots';
import { StrategicBot } from '../core/ai/strategic';
import { EvolvingBot } from '../core/ai/evolving';
import { runBattle } from './run-game';
import { LoggingBot, saveMatchLog, saveMatchText, saveDecisions, type MatchMeta } from './logger';
import type { GameState, Color, School } from '../core/types';
import boardDataJSON from '../board-data.json';

export interface SimConfig {
  seed: number;
  playerColors: Color[];
  botTypes: ('heuristic' | 'random' | 'evolving' | 'strategic')[];
  maxTurns?: number;
  recordDir?: string; // if set, save match log + AI decisions to this dir
}

export interface SimResult {
  winner: number | null;
  turns: number;
  log: string[];
  finalState: GameState;
  logFiles?: string[];
}

function makeBot(type: 'heuristic' | 'random' | 'evolving' | 'strategic'): AIPlayer {
  if (type === 'heuristic') return new HeuristicBot();
  if (type === 'evolving') return new EvolvingBot('Evolving Bot');
  if (type === 'strategic') return new StrategicBot('Strategic Bot');
  return new RandomBot();
}

export async function runSimulation(config: SimConfig): Promise<SimResult> {
  loadBuiltInCards();
  const topo = convertBoardData(boardDataJSON as any);
  const board = createBoardFromTopology(topo);
  const schools: School[] = ['cantrip', 'alchemy', 'elemental', 'mentalism'];
  const deck = buildDeck(schools);

  const state = createGameState(
    {
      seed: config.seed,
      playerColors: config.playerColors,
      botSeats: config.playerColors.map(() => true),
      schools,
      cantripSchool: 'cantrip',
    },
    board,
    deck,
  );

  let bots: AIPlayer[] = config.botTypes.map(makeBot);
  const maxTurns = config.maxTurns ?? 500;

  // Wrap bots in decision loggers when recording is requested.
  let loggers: LoggingBot[] | null = null;
  if (config.recordDir) {
    loggers = bots.map((b) => new LoggingBot(b, config.playerColors));
    bots = loggers;
  }

  // Use runBattle as the unified driver.
  const result = await runBattle(state, bots, {
    seed: config.seed,
    playerColors: config.playerColors,
    botTypes: config.botTypes,
    schools,
    maxTurns,
    delayMs: 0,
  });

  const out: SimResult = {
    winner: result.winner,
    turns: result.turns,
    log: state.log.map((l) => l.text),
    finalState: state,
  };

  // Optional: persist the match log + AI decisions.
  if (config.recordDir) {
    const meta: MatchMeta = {
      seed: config.seed,
      botTypes: config.botTypes,
      playerColors: config.playerColors,
      winner: result.winner,
      turns: result.turns,
      maxTurns,
      schools: schools.map((s) => String(s)),
    };
    const base = `${config.recordDir}/match-${config.seed}`;
    saveMatchLog(state, meta, `${base}.json`);
    saveMatchText(state, meta, `${base}.txt`);
    if (loggers) saveDecisions(loggers, meta, `${base}.decisions.json`);
    out.logFiles = [`${base}.json`, `${base}.txt`, `${base}.decisions.json`];
  }

  return out;
}

// CLI entry point.
async function main() {
  const args = process.argv.slice(2);
  const useEvolving = args.includes('--evolving');
  const useStrategic = args.includes('--strategic');
  const recordFlag = args.find((a) => a.startsWith('--record'));
  const recordDir = recordFlag ? recordFlag.split('=')[1] ?? 'logs' : undefined;
  const seedArg = args.find((a) => !a.startsWith('--'));
  const seed = seedArg ? parseInt(seedArg, 10) : 42;

  console.log(`Running simulation with seed ${seed}...`);
  console.log(`Using ${useEvolving ? 'evolving' : useStrategic ? 'strategic' : 'heuristic'} bots${recordDir ? ` (recording to ${recordDir}/)` : ''}`);

  const result = await runSimulation({
    seed,
    playerColors: ['blue', 'red', 'yellow', 'green'],
    botTypes: useEvolving
      ? ['evolving', 'evolving', 'evolving', 'evolving']
      : useStrategic
        ? ['strategic', 'strategic', 'strategic', 'strategic']
        : ['heuristic', 'heuristic', 'heuristic', 'heuristic'],
    recordDir,
  });
  console.log(`Winner: ${result.winner === null ? 'None (max turns)' : result.finalState.players[result.winner].color}`);
  console.log(`Turns: ${result.turns}`);
  console.log(`Log entries: ${result.log.length}`);
  if (result.logFiles?.length) {
    console.log('Recorded files:');
    for (const f of result.logFiles) console.log(`  ${f}`);
  }
  if (result.log.length > 0 && !result.logFiles) {
    console.log('Last 10 log entries:');
    for (const entry of result.log.slice(-10)) {
      console.log(`  ${entry}`);
    }
  }
}

if (process.argv[1] && process.argv[1].includes('sim.ts')) {
  main().catch((err) => {
    console.error('Simulation failed:', err);
    process.exit(1);
  });
}