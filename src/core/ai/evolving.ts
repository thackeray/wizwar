// Self-evolving AI using genetic algorithm with self-play.

import type { GameState, Action } from '../types';
import { DIR_DELTA } from '../types';
import { getCard } from '../cards/registry';
import { hasLOS, toGlobal } from '../board';
import { currentPlayer } from '../state';
import type { AIPlayer } from './bots';

// Strategy parameters that can evolve.
export interface StrategyParams {
  // Movement weights
  aggression: number; // 0-1: how aggressively to approach enemies
  defense: number; // 0-1: how much to avoid enemies
  treasureSeek: number; // 0-1: how much to seek treasure
  exploration: number; // 0-1: how much to explore new areas
  
  // Combat weights
  punchThreshold: number; // 0-1: how close to punch (0.5 = adjacent)
  castThreshold: number; // 0-1: how far to cast (0.5 = half board)
  saveCards: number; // 0-1: how much to save cards for later
  
  // Card usage weights
  attackCardPriority: number; // 0-1: priority of attack cards
  utilityCardPriority: number; // 0-1: priority of utility cards
  energyCardPriority: number; // 0-1: priority of energy cards
}

// Default parameters.
export const DEFAULT_PARAMS: StrategyParams = {
  aggression: 0.5,
  defense: 0.3,
  treasureSeek: 0.4,
  exploration: 0.3,
  punchThreshold: 0.5,
  castThreshold: 0.5,
  saveCards: 0.3,
  attackCardPriority: 0.8,
  utilityCardPriority: 0.5,
  energyCardPriority: 0.2,
};

// Evolving bot with tunable parameters.
export class EvolvingBot implements AIPlayer {
  name: string;
  params: StrategyParams;
  fitness: number = 0;
  wins: number = 0;
  losses: number = 0;
  
  constructor(name: string, params?: StrategyParams) {
    this.name = name;
    this.params = params ? { ...params } : { ...DEFAULT_PARAMS };
  }
  
  async chooseAction(state: GameState, legalActions: Action[]): Promise<Action> {
    const p = currentPlayer(state);
    
    // In discard-draw phase, draw cards and end turn.
    if (state.phase === 'discard-draw') {
      const draw = legalActions.find((a) => a.type === 'draw' && a.count === 2);
      if (draw) return draw;
      return { type: 'end-turn' };
    }
    
    // If no MP left, end turn.
    if (p.mp <= 0) {
      return { type: 'end-turn' };
    }
    
    // Score each action and pick the best.
    let bestAction = legalActions[0];
    let bestScore = -Infinity;
    
    for (const action of legalActions) {
      // Skip move actions if no MP.
      if (action.type === 'move' && p.mp < 1) continue;
      
      const score = this.scoreAction(state, p, action);
      if (score > bestScore) {
        bestScore = score;
        bestAction = action;
      }
    }
    
    return bestAction;
  }
  
  private scoreAction(state: GameState, p: GameState['players'][0], action: Action): number {
    const myGlobal = toGlobal(p.pos);
    let score = 0;
    
    switch (action.type) {
      case 'move': {
        const d = DIR_DELTA[action.dir];
        const nr = myGlobal.row + d.dr;
        const nc = myGlobal.col + d.dc;
        
        // Score based on distance to enemies and treasure.
        for (const t of state.players) {
          if (t.id === p.id || !t.alive) continue;
          const tg = toGlobal(t.pos);
          const dist = Math.abs(nr - tg.row) + Math.abs(nc - tg.col);
          
          // Aggression: prefer moving closer to enemies.
          score += this.params.aggression * (10 - dist);
          
          // Defense: prefer moving away from enemies.
          score += this.params.defense * dist;
        }
        
        // Treasure seeking: prefer moving toward treasure.
        for (const color of ['blue', 'red', 'yellow', 'green'] as const) {
          const sector = state.board.sectors[color];
          for (let r = 0; r < sector.grid.length; r++) {
            for (let c = 0; c < sector.grid[r].length; c++) {
              if (sector.grid[r][c].treasures.length > 0) {
                const cellGlobal = toGlobal({ sector: color, r, c });
                const dist = Math.abs(nr - cellGlobal.row) + Math.abs(nc - cellGlobal.col);
                score += this.params.treasureSeek * (10 - dist);
              }
            }
          }
        }
        
        // Exploration: prefer unvisited cells (simplified: prefer center).
        const centerDist = Math.abs(nr - 5) + Math.abs(nc - 5);
        score += this.params.exploration * (10 - centerDist);
        
        break;
      }
      
      case 'punch': {
        // Only punch if within threshold distance.
        const target = state.players.find((pl) => pl.id === action.target)!;
        const tg = toGlobal(target.pos);
        const dist = Math.abs(myGlobal.row - tg.row) + Math.abs(myGlobal.col - tg.col);
        const threshold = this.params.punchThreshold * 10;
        
        if (dist <= threshold) {
          score += 5; // High priority for punching.
        }
        
        break;
      }
      
      case 'cast': {
        const card = getCard(action.cardId);
        if (!card) break;
        
        // Score based on card type and priority.
        if (card.type === 'attack-spell') {
          score += this.params.attackCardPriority * 3;
          
          // Check if any enemy is in range.
          for (const t of state.players) {
            if (t.id === p.id || !t.alive) continue;
            if (hasLOS(state.board, p.pos, t.pos)) {
              score += 2;
              break;
            }
          }
        } else if (card.type === 'neutral-spell') {
          score += this.params.utilityCardPriority * 2;
        } else if (card.type === 'transform') {
          score += 1;
        }
        
        // §16.4.2: Use castThreshold to determine if casting is worthwhile.
        if (card.type === 'attack-spell') {
          const threshold = this.params.castThreshold * 10;
          let inRange = false;
          for (const t of state.players) {
            if (t.id === p.id || !t.alive) continue;
            const tg = toGlobal(t.pos);
            const dist = Math.abs(myGlobal.row - tg.row) + Math.abs(myGlobal.col - tg.col);
            if (dist <= threshold) {
              inRange = true;
              break;
            }
          }
          if (!inRange) score -= 2; // Penalize casting when no target in range.
        }
        
        // Save cards: reduce score if we have many cards.
        score -= this.params.saveCards * p.hand.length * 0.1;
        
        break;
      }
      
      case 'use-item': {
        score += 2; // Using items is generally good.
        break;
      }
      
      // §16.4.2: Add treasure-seeking behavior.
      case 'pick-up-treasure': {
        // High priority to pick up treasure.
        score += this.params.treasureSeek * 5;
        break;
      }
      
      case 'drop-treasure': {
        // Drop treasure if we're in our home sector.
        const cell = state.board.sectors[p.pos.sector].grid[p.pos.r][p.pos.c];
        if (cell.kind === 'home' && p.pos.sector === p.color) {
          score += this.params.treasureSeek * 4;
        }
        break;
      }
      
      case 'end-turn': {
        // Low priority, only if no other good actions.
        score = -1;
        break;
      }
      
      default:
        score = 0;
    }
    
    return score;
  }
}

// Genetic algorithm for evolving strategies.
export class GeneticEvolver {
  population: EvolvingBot[];
  populationSize: number;
  mutationRate: number;
  mutationStrength: number;
  tournamentSize: number;
  
  constructor(
    populationSize = 20,
    mutationRate = 0.1,
    mutationStrength = 0.2,
    tournamentSize = 3,
  ) {
    this.populationSize = populationSize;
    this.mutationRate = mutationRate;
    this.mutationStrength = mutationStrength;
    this.tournamentSize = tournamentSize;
    this.population = this.initPopulation();
  }
  
  private initPopulation(): EvolvingBot[] {
    const bots: EvolvingBot[] = [];
    for (let i = 0; i < this.populationSize; i++) {
      const params = this.randomParams();
      bots.push(new EvolvingBot(`Bot-${i}`, params));
    }
    return bots;
  }
  
  private randomParams(): StrategyParams {
    return {
      aggression: Math.random(),
      defense: Math.random(),
      treasureSeek: Math.random(),
      exploration: Math.random(),
      punchThreshold: Math.random(),
      castThreshold: Math.random(),
      saveCards: Math.random(),
      attackCardPriority: Math.random(),
      utilityCardPriority: Math.random(),
      energyCardPriority: Math.random(),
    };
  }
  
  // Run a generation of self-play matches.
  async runGeneration(matchesPerBot = 5): Promise<void> {
    // Reset fitness.
    for (const bot of this.population) {
      bot.fitness = 0;
      bot.wins = 0;
      bot.losses = 0;
    }
    
    // Run matches.
    for (let i = 0; i < this.populationSize; i++) {
      for (let j = 0; j < matchesPerBot; j++) {
        const opponentIdx = Math.floor(Math.random() * this.populationSize);
        if (opponentIdx === i) continue;
        
        const winner = await this.playMatch(this.population[i], this.population[opponentIdx]);
        if (winner === 0) {
          this.population[i].wins++;
          this.population[i].fitness += 1;
        } else if (winner === 1) {
          this.population[opponentIdx].wins++;
          this.population[opponentIdx].fitness += 1;
        }
      }
    }
    
    // Evolve population.
    this.evolve();
  }
  
  private async playMatch(bot1: EvolvingBot, bot2: EvolvingBot): Promise<number> {
    // M6: Run a real match using runBattle.
    const { createBoardFromTopology } = await import('../board');
    const { createGameState } = await import('../state');
    const { buildDeck } = await import('../cards/registry');
    const { loadBuiltInCards } = await import('../cards');
    const { runBattle } = await import('../../headless/run-game');
    const { convertBoardData } = await import('../board-data');
    
    loadBuiltInCards();
    // §16.4.1: Use real board topology for evolution.
    const boardDataJson = (await import('../../board-data.json', { assert: { type: 'json' } })).default as any;
    const boardData = convertBoardData(boardDataJson);
    const board = createBoardFromTopology(boardData);
    const deck = buildDeck(['cantrip', 'alchemy', 'elemental']);
    const state = createGameState(
      {
        seed: Math.floor(Math.random() * 10000),
        playerColors: ['blue', 'red'],
        botSeats: [true, true],
        schools: ['cantrip', 'alchemy', 'elemental'],
        cantripSchool: 'cantrip',
      },
      board,
      deck,
    );
    
    const bots = [bot1, bot2];
    const result = await runBattle(state, bots, {
      seed: state.seed,
      playerColors: ['blue', 'red'],
      botTypes: ['evolving', 'evolving'],
      schools: ['cantrip', 'alchemy', 'elemental'],
      maxTurns: 100, // Shorter matches for evolution
    });
    
    if (result.winner === null) return -1; // Draw
    return result.winner; // 0 for bot1, 1 for bot2
  }
  
  private evolve(): void {
    const nextGen: EvolvingBot[] = [];
    
    // Elitism: keep the best 2 bots.
    const sorted = [...this.population].sort((a, b) => b.fitness - a.fitness);
    nextGen.push(sorted[0], sorted[1]);
    
    // Fill the rest with offspring.
    while (nextGen.length < this.populationSize) {
      const parent1 = this.tournamentSelect();
      const parent2 = this.tournamentSelect();
      const child = this.crossover(parent1, parent2);
      this.mutate(child);
      nextGen.push(child);
    }
    
    this.population = nextGen;
  }
  
  private tournamentSelect(): EvolvingBot {
    const tournament: EvolvingBot[] = [];
    for (let i = 0; i < this.tournamentSize; i++) {
      tournament.push(this.population[Math.floor(Math.random() * this.populationSize)]);
    }
    return tournament.sort((a, b) => b.fitness - a.fitness)[0];
  }
  
  private crossover(p1: EvolvingBot, p2: EvolvingBot): EvolvingBot {
    const params = { ...DEFAULT_PARAMS };
    for (const key of Object.keys(DEFAULT_PARAMS) as (keyof StrategyParams)[]) {
      params[key] = Math.random() < 0.5 ? p1.params[key] : p2.params[key];
    }
    return new EvolvingBot('Child', params);
  }
  
  private mutate(bot: EvolvingBot): void {
    for (const key of Object.keys(DEFAULT_PARAMS) as (keyof StrategyParams)[]) {
      if (Math.random() < this.mutationRate) {
        const delta = (Math.random() - 0.5) * 2 * this.mutationStrength;
        bot.params[key] = Math.max(0, Math.min(1, bot.params[key] + delta));
      }
    }
  }
  
  // Get the best bot from the current population.
  getBestBot(): EvolvingBot {
    return [...this.population].sort((a, b) => b.fitness - a.fitness)[0];
  }
  
  // Get population statistics.
  getStats(): { avgFitness: number; bestFitness: number; bestParams: StrategyParams } {
    const avgFitness = this.population.reduce((sum, b) => sum + b.fitness, 0) / this.populationSize;
    const best = this.getBestBot();
    return {
      avgFitness,
      bestFitness: best.fitness,
      bestParams: { ...best.params },
    };
  }
}