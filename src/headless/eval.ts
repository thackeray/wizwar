// Evaluate bot win rate across many seeds.
// Usage: npx tsx src/headless/eval.ts <botType> [seedStart] [seedCount] [maxTurns]
//   botType: 'heuristic' | 'strategic' | 'evolving' | 'random'
import { createBoardFromTopology } from '../core/board';
import { convertBoardData } from '../core/board-data';
import { createGameState } from '../core/state';
import { loadBuiltInCards } from '../core/cards';
import { buildDeck } from '../core/cards/registry';
import { HeuristicBot, RandomBot, type AIPlayer } from '../core/ai/bots';
import { StrategicBot } from '../core/ai/strategic';
import { EvolvingBot } from '../core/ai/evolving';
import { runBattle } from './run-game';
import boardDataJSON from '../board-data.json';
import type { Color } from '../core/types';

function makeBot(type: string, weights?: Partial<import('../core/ai/strategic').StrategicWeights>): AIPlayer {
  switch (type) {
    case 'heuristic': return new HeuristicBot();
    case 'strategic': return new StrategicBot('Strategic Bot', weights);
    case 'evolving': return new EvolvingBot('Evolving Bot');
    default: return new RandomBot();
  }
}

export async function evalBots(
  botType: string,
  seedStart: number,
  seedCount: number,
  maxTurns: number,
  playerColors: Color[] = ['blue', 'red', 'yellow', 'green'],
): Promise<{ wins: Record<string, number>; stalled: number; totalTurns: number; games: number; kills: number; vpEvents: number }> {
  loadBuiltInCards();
  const topo = convertBoardData(boardDataJSON as any);
  const wins: Record<string, number> = {};
  let stalled = 0, totalTurns = 0, kills = 0, vpEvents = 0;

  for (let s = seedStart; s < seedStart + seedCount; s++) {
    const board = createBoardFromTopology(topo);
    const schools: any[] = ['cantrip', 'alchemy', 'elemental', 'mentalism'];
    const state = createGameState(
      { seed: s, playerColors, botSeats: playerColors.map(() => true), schools, cantripSchool: 'cantrip' },
      board, buildDeck(schools),
    );
    // Optional per-seat weights via env or argv: "blue:red:yellow:green" JSON per seat.
    let bots: AIPlayer[];
    const weightsArg = process.env.BOT_WEIGHTS;
    if (botType === 'strategic' && weightsArg) {
      const perSeat = weightsArg.split(';').map((w) => JSON.parse(w));
      bots = playerColors.map((_, i) => makeBot('strategic', perSeat[i % perSeat.length]));
    } else {
      bots = playerColors.map(() => makeBot(botType));
    }
    const res = await runBattle(state, bots, {
      seed: s, playerColors, botTypes: playerColors.map(() => botType), schools, maxTurns,
    });
    totalTurns += res.turns;
    if (res.winner === null) { stalled++; }
    else { wins[state.players[res.winner].color] = (wins[state.players[res.winner].color] ?? 0) + 1; }
    kills += state.log.filter((l) => l.text.includes('eliminated')).length;
    vpEvents += state.log.filter((l) => l.text.includes('scores 1 VP')).length;
  }

  return { wins, stalled, totalTurns, games: seedCount, kills, vpEvents };
}

async function main() {
  const botType = process.argv[2] ?? 'heuristic';
  const seedStart = parseInt(process.argv[3] ?? '1', 10);
  const seedCount = parseInt(process.argv[4] ?? '20', 10);
  const maxTurns = parseInt(process.argv[5] ?? '300', 10);
  const r = await evalBots(botType, seedStart, seedCount, maxTurns);
  console.log(`== ${botType} ×4, seeds ${seedStart}..${seedStart + seedCount - 1}, maxTurns ${maxTurns} ==`);
  console.log(`games=${r.games} won=${Object.values(r.wins).reduce((a, b) => a + b, 0)} stalled=${r.stalled} avgTurns=${Math.round(r.totalTurns / r.games)}`);
  console.log(`wins by color: ${JSON.stringify(r.wins)}`);
  console.log(`kills total=${r.kills} vpEvents total=${r.vpEvents}`);
  
  // §18.2: Show sector difficulty rating based on win rates.
  const totalWins = Object.values(r.wins).reduce((a, b) => a + b, 0);
  if (totalWins > 0) {
    console.log(`\nSector difficulty (based on win rate):`);
    for (const color of ['blue', 'red', 'yellow', 'green']) {
      const winRate = (r.wins[color] ?? 0) / totalWins;
      const stars = winRate > 0.4 ? '★★★ (strong)' : winRate > 0.2 ? '★★ (medium)' : winRate > 0.1 ? '★ (weak)' : '☆ (very weak)';
      console.log(`  ${color}: ${winRate.toFixed(1)}% ${stars}`);
    }
  }
}

if (process.argv[1] && process.argv[1].includes('eval.ts')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
