// Evolutionary training for StrategicBot weights (genetic policy search).
// Population of weight vectors co-evolves via 4-player self-play on the REAL board.
//
// Note: results are currently bounded by the board asymmetry (green sector is
// advantaged, see IMPLEMENTATION_PLAN §18). Training still finds weights that win
// from harder seats and produces diverse personalities for a 4-bot game.
//
// Usage: npx tsx src/headless/train.ts [generations] [populationSize] [gamesPerBot]
import { createBoardFromTopology } from '../core/board';
import { convertBoardData } from '../core/board-data';
import { createGameState } from '../core/state';
import { loadBuiltInCards } from '../core/cards';
import { buildDeck } from '../core/cards/registry';
import { StrategicBot, type StrategicWeights, DEFAULT_STRATEGIC } from '../core/ai/strategic';
import { runBattle } from './run-game';
import boardDataJSON from '../board-data.json';

const COLORS = ['blue', 'red', 'yellow', 'green'] as const;

type WKey = keyof StrategicWeights;

function randomWeights(): StrategicWeights {
  const w: StrategicWeights = { ...DEFAULT_STRATEGIC };
  (Object.keys(DEFAULT_STRATEGIC) as WKey[]).forEach((k) => {
    w[k] = (0.1 + Math.random() * 0.9) as never;
  });
  return w;
}

function mutate(w: StrategicWeights, rate: number, strength: number): StrategicWeights {
  const out = { ...w };
  (Object.keys(out) as WKey[]).forEach((k) => {
    if (Math.random() < rate) {
      out[k] = (Math.max(0, Math.min(1, (out[k] as number) + (Math.random() - 0.5) * 2 * strength)) as never);
    }
  });
  return out;
}

function crossover(a: StrategicWeights, b: StrategicWeights): StrategicWeights {
  const out = { ...a };
  (Object.keys(out) as WKey[]).forEach((k) => {
    if (Math.random() < 0.5) out[k] = b[k] as number;
  });
  return out;
}

// Play one 4-bot match. Returns winner color or null.
async function playMatch(weights: StrategicWeights[], seed: number): Promise<string | null> {
  const board = createBoardFromTopology(convertBoardData(boardDataJSON as any));
  const state = createGameState(
    { seed, playerColors: [...COLORS], botSeats: [true, true, true, true],
      schools: ['cantrip', 'alchemy', 'elemental', 'mentalism'], cantripSchool: 'cantrip' },
    board, buildDeck(['cantrip', 'alchemy', 'elemental', 'mentalism']),
  );
  const bots = weights.map((w, i) => new StrategicBot(`bot${i}`, w));
  const res = await runBattle(state, bots, {
    seed, playerColors: [...COLORS], botTypes: COLORS.map(() => 'strategic'),
    schools: ['cantrip', 'alchemy', 'elemental', 'mentalism'], maxTurns: 200,
  });
  return res.winner === null ? null : state.players[res.winner].color;
}

async function main() {
  const generations = parseInt(process.argv[2] ?? '12', 10);
  const populationSize = parseInt(process.argv[3] ?? '8', 10);
  const gamesPerBot = parseInt(process.argv[4] ?? '2', 10);

  loadBuiltInCards();
  let pop: StrategicWeights[] = [];
  for (let i = 0; i < populationSize; i++) pop.push(randomWeights());
  const best = { fitness: -Infinity, weights: DEFAULT_STRATEGIC };

  for (let gen = 0; gen < generations; gen++) {
    const fitness = new Array<number>(populationSize).fill(0);
    // Each individual plays `gamesPerBot` matches against 3 random others.
    for (let i = 0; i < populationSize; i++) {
      for (let g = 0; g < gamesPerBot; g++) {
        const others = Array.from({ length: 3 }, () => pop[Math.floor(Math.random() * populationSize)]);
        const seats: StrategicWeights[] = [pop[i], ...others];
        // Randomly place i in a seat so it isn't always blue.
        const seat = Math.floor(Math.random() * 4);
        [seats[0], seats[seat]] = [seats[seat], seats[0]];
        const winner = await playMatch(seats, Math.floor(Math.random() * 10000));
        const winnerIdx = winner === null ? -1 : COLORS.indexOf(winner as any);
        if (winnerIdx === seat) fitness[i] += 1;
        else if (winnerIdx !== -1) fitness[i] -= 0.2; // small penalty for losing
      }
    }

    // Track best-so-far.
    for (let i = 0; i < populationSize; i++) {
      if (fitness[i] > best.fitness) {
        best.fitness = fitness[i];
        best.weights = { ...pop[i] };
      }
    }
    const avg = fitness.reduce((a, b) => a + b, 0) / populationSize;
    console.log(`Gen ${gen + 1}/${generations}: avg=${avg.toFixed(2)} best=${Math.max(...fitness)}`);

    // Evolve: keep top half, breed the rest.
    const ranked = pop.map((w, i) => ({ w, f: fitness[i] })).sort((a, b) => b.f - a.f);
    const next = ranked.slice(0, Math.ceil(populationSize / 2)).map((r) => ({ ...r.w }));
    while (next.length < populationSize) {
      const p1 = ranked[Math.floor(Math.random() * Math.ceil(populationSize / 2))].w;
      const p2 = ranked[Math.floor(Math.random() * Math.ceil(populationSize / 2))].w;
      next.push(mutate(crossover(p1, p2), 0.15, 0.2));
    }
    pop = next;
  }

  console.log('\n=== Best weights ===');
  console.log(JSON.stringify(best.weights, null, 2));
}

if (process.argv[1] && process.argv[1].includes('train.ts')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
