// Main App component
import React, { useState } from 'react';
import SetupScreen from './components/SetupScreen';
import BattleScreen from './components/BattleScreen';

export interface GameConfig {
  playerCount: number;
  botTypes: ('random' | 'heuristic' | 'strategic' | 'human')[];
  schools: string[];
  speed: 'slow' | 'medium' | 'fast' | 'instant';
  seed: number;
}

export default function App() {
  const [gameConfig, setGameConfig] = useState<GameConfig | null>(null);
  
  if (!gameConfig) {
    return <SetupScreen onStart={setGameConfig} />;
  }
  
  return <BattleScreen config={gameConfig} onExit={() => setGameConfig(null)} />;
}