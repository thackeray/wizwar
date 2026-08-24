// Battle screen component
import React from 'react';
import type { GameConfig } from '../App';

interface Props {
  config: GameConfig;
  onExit: () => void;
}

export default function BattleScreen({ config, onExit }: Props) {
  return (
    <div className="battle">
      <header className="battle-header">
        <h1 className="battle-title">Wiz-War Battle</h1>
        <button className="battle-exit" onClick={onExit}>Exit</button>
      </header>
      
      <div className="battle-main">
        <div className="battle-board">
          {/* Board will be rendered here */}
          <div className="board-placeholder">
            Board (10x10 grid)
          </div>
        </div>
        
        <div className="battle-sidebar">
          <div className="battle-players">
            {/* Player panels will be rendered here */}
            <div className="player-panel-placeholder">
              Player Panels
            </div>
          </div>
          
          <div className="battle-hand">
            {/* Hand will be rendered here */}
            <div className="hand-placeholder">
              Hand
            </div>
          </div>
          
          <div className="battle-log">
            {/* Log will be rendered here */}
            <div className="log-placeholder">
              Game Log
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}