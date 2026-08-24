// Mock prototype for UI review
import React from 'react';
import ReactDOM from 'react-dom/client';
import './mock.css';

// Mock data
const mockPlayers = [
  { id: 0, color: 'blue', name: 'Blue Wizard', life: 15, maxLife: 20, vp: 1, mp: 3, maxMp: 3, stunned: false, transformed: false, carryingTreasure: true },
  { id: 1, color: 'red', name: 'Red Wizard', life: 12, maxLife: 20, vp: 0, mp: 2, maxMp: 3, stunned: true, transformed: false, carryingTreasure: false },
  { id: 2, color: 'yellow', name: 'Yellow Wizard', life: 18, maxLife: 20, vp: 1, mp: 3, maxMp: 3, stunned: false, transformed: true, carryingTreasure: false },
  { id: 3, color: 'green', name: 'Green Wizard', life: 15, maxLife: 20, vp: 0, mp: 1, maxMp: 3, stunned: false, transformed: false, carryingTreasure: true },
];

const mockCards = [
  { id: 'card1', name: 'Fire Bolt', school: 'elemental', energy: 2, text: 'Deal 3 fire damage to target wizard.' },
  { id: 'card2', name: 'Shield', school: 'mentalism', energy: 2, text: 'Reduce damage by 4 until next turn.' },
  { id: 'card3', name: 'Teleport', school: 'conjuring', energy: 3, text: 'Move to any visible square.' },
  { id: 'card4', name: 'Energy', school: 'cantrip', energy: 5, text: 'Gain 5 energy.' },
];

const colorMap: Record<string, string> = {
  blue: 'bg-blue-500',
  red: 'bg-red-500',
  yellow: 'bg-yellow-500',
  green: 'bg-green-500',
};

function PlayerPanel({ player }: { player: typeof mockPlayers[0] }) {
  const lifePercent = (player.life / player.maxLife) * 100;
  const mpDots = Array.from({ length: player.maxMp }, (_, i) => i < player.mp);
  
  return (
    <div className={`player-panel ${colorMap[player.color]}-border`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-3 h-3 rounded-full ${colorMap[player.color]}`}></div>
        <span className="font-bold text-sm">{player.name}</span>
        {player.stunned && <span className="text-xs bg-yellow-600 px-1 rounded">⚡</span>}
        {player.transformed && <span className="text-xs bg-purple-600 px-1 rounded">🔄</span>}
        {player.carryingTreasure && <span className="text-xs bg-amber-600 px-1 rounded">◆</span>}
      </div>
      
      <div className="mb-2">
        <div className="flex justify-between text-xs mb-1">
          <span>Life</span>
          <span>{player.life}/{player.maxLife}</span>
        </div>
        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-red-500 to-green-500 transition-all" 
            style={{ width: `${lifePercent}%` }}
          ></div>
        </div>
      </div>
      
      <div className="flex justify-between items-center text-xs">
        <div className="flex gap-1">
          {mpDots.map((filled, i) => (
            <div key={i} className={`w-2 h-2 rounded-full ${filled ? 'bg-blue-400' : 'bg-gray-600'}`}></div>
          ))}
        </div>
        <span className="text-amber-400">{'★'.repeat(player.vp)}{'☆'.repeat(2 - player.vp)}</span>
      </div>
    </div>
  );
}

function Card({ card, selected, onClick }: { card: typeof mockCards[0], selected: boolean, onClick: () => void }) {
  const schoolColors: Record<string, string> = {
    elemental: 'border-orange-500',
    mentalism: 'border-purple-500',
    conjuring: 'border-green-500',
    cantrip: 'border-blue-500',
  };
  
  return (
    <div 
      className={`card ${schoolColors[card.school]} ${selected ? 'card-selected' : ''}`}
      onClick={onClick}
    >
      <div className="card-energy">{card.energy}</div>
      <div className="card-name">{card.name}</div>
      <div className="card-school">{card.school}</div>
      <div className="card-text">{card.text}</div>
    </div>
  );
}

function Board() {
  // Mock board with 10x10 grid
  const cells = Array.from({ length: 100 }, (_, i) => {
    const row = Math.floor(i / 10);
    const col = i % 10;
    const sector = row < 5 ? (col < 5 ? 'blue' : 'red') : (col < 5 ? 'yellow' : 'green');
    return { row, col, sector };
  });
  
  return (
    <div className="board">
      {cells.map((cell, i) => (
        <div 
          key={i} 
          className={`board-cell board-cell--${cell.sector}`}
          data-row={cell.row}
          data-col={cell.col}
        >
          {(cell.row === 2 && cell.col === 2) && <div className="token token--blue">B</div>}
          {(cell.row === 2 && cell.col === 7) && <div className="token token--red">R</div>}
          {(cell.row === 7 && cell.col === 2) && <div className="token token--yellow">Y</div>}
          {(cell.row === 7 && cell.col === 7) && <div className="token token--green">G</div>}
        </div>
      ))}
    </div>
  );
}

function App() {
  const [selectedCard, setSelectedCard] = React.useState<string | null>(null);
  
  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Wiz-War</h1>
        <div className="app-meta">Turn 15 | Blue's Turn</div>
      </header>
      
      <div className="app-main">
        <div className="app-board">
          <Board />
        </div>
        
        <div className="app-sidebar">
          <div className="player-panels">
            {mockPlayers.map((player) => (
              <PlayerPanel key={player.id} player={player} />
            ))}
          </div>
          
          <div className="hand">
            <div className="hand-label">Your Hand</div>
            <div className="hand-cards">
              {mockCards.map((card) => (
                <Card 
                  key={card.id} 
                  card={card} 
                  selected={selectedCard === card.id}
                  onClick={() => setSelectedCard(selectedCard === card.id ? null : card.id)}
                />
              ))}
            </div>
          </div>
          
          <div className="log-panel">
            <div className="log-title">Game Log</div>
            <div className="log-content">
              <div className="log-line">Blue Wizard casts Fire Bolt</div>
              <div className="log-line">Red Wizard takes 3 damage</div>
              <div className="log-line">Yellow Wizard moves to (7,3)</div>
              <div className="log-line">Green Wizard picks up treasure</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<App />);