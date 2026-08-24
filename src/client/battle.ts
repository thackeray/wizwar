// AI Battle: Handles game setup and battle logic.

import type { GameState, Color, School } from '../core/types';
import { createBoardFromTopology } from '../core/board';
import { convertBoardData } from '../core/board-data';
import { createGameState } from '../core/state';
import { loadBuiltInCards } from '../core/cards';
import { buildDeck } from '../core/cards/registry';
import { HeuristicBot, RandomBot, type AIPlayer } from '../core/ai/bots';
import { EvolvingBot } from '../core/ai/evolving';
import { runBattle } from '../headless/run-game';
import { BattleUI } from './battle-ui';
import boardDataJSON from '../board-data.json';

export interface BattleConfig {
  playerCount: number;
  botTypes: ('random' | 'heuristic' | 'evolving' | 'human')[];
  schools: School[];
  speed: 'slow' | 'medium' | 'fast' | 'instant';
  seed: number;
}

export class Battle {
  private state: GameState;
  private bots: AIPlayer[];
  private ui: BattleUI;
  private delayMs: number = 100;

  constructor(container: HTMLElement, config: BattleConfig) {
    loadBuiltInCards();
    
    const boardData = convertBoardData(boardDataJSON as any);
    const board = createBoardFromTopology(boardData);
    const deck = buildDeck(config.schools);
    
    const allColors: Color[] = ['blue', 'red', 'yellow', 'green'];
    const playerColors = allColors.slice(0, config.playerCount);
    
    this.state = createGameState(
      {
        seed: config.seed,
        playerColors,
        botSeats: playerColors.map(() => true), // All bots
        schools: config.schools,
        cantripSchool: config.schools[0],
      },
      board,
      deck,
    );
    
    // Create bots based on config.
    this.bots = config.botTypes.map((type, i) => {
      switch (type) {
        case 'random':
          return new RandomBot();
        case 'heuristic':
          return new HeuristicBot();
        case 'evolving':
          return new EvolvingBot(`Bot ${i}`);
        case 'human':
          // Placeholder: Use HeuristicBot for now.
          // Full human interaction would require UI changes.
          return new HeuristicBot();
        default:
          return new HeuristicBot();
      }
    });
    
    // Set delay based on speed.
    switch (config.speed) {
      case 'slow':
        this.delayMs = 500;
        break;
      case 'medium':
        this.delayMs = 200;
        break;
      case 'fast':
        this.delayMs = 50;
        break;
      case 'instant':
        this.delayMs = 0;
        break;
    }
    
    // Initialize UI.
    this.ui = new BattleUI(container, this.state);
  }
  
  async start(): Promise<void> {
    await runBattle(this.state, this.bots, {
      seed: this.state.seed,
      playerColors: this.state.players.map((p) => p.color),
      botTypes: this.bots.map((b) => b.name),
      schools: [],
      maxTurns: 500,
      delayMs: this.delayMs,
      callbacks: {
        afterAction: async () => {
          this.ui.render();
          if (this.delayMs > 0) {
            await this.sleep(this.delayMs);
          }
        },
        onWinner: async () => {
          // Battle ended.
        },
      },
    });
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}