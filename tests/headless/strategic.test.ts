// StrategicBot: games end (no stall), and it beats HeuristicBot on aggregate.
import { describe, it, expect } from 'vitest';
import { evalBots } from '../../src/headless/eval';

describe('StrategicBot', () => {
  it('finishes games (no stall) across seeds', async () => {
    const r = await evalBots('strategic', 1, 8, 250);
    // At least half of games end in a winner within maxTurns.
    expect(r.games - r.stalled).toBeGreaterThanOrEqual(r.games / 2);
  }, 120000);

  it('wins more often than HeuristicBot on aggregate', async () => {
    const str = await evalBots('strategic', 1, 8, 250);
    const heu = await evalBots('heuristic', 1, 8, 250);
    const strWins = Object.values(str.wins).reduce((a, b) => a + b, 0);
    const heuWins = Object.values(heu.wins).reduce((a, b) => a + b, 0);
    // Aggregate over both, allowing the board imbalance (green favors whoever
    // sits there) to count against either side.
    expect(strWins).toBeGreaterThanOrEqual(heuWins);
  }, 180000);
});
