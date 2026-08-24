// Setup screen component
import React, { useState } from 'react';
import type { GameConfig } from '../App';

const CHOOSABLE_SCHOOLS = [
  'alchemy',
  'conjuring',
  'elemental',
  'mentalism',
  'mutation',
  'thaumaturgy',
];

interface Props {
  onStart: (config: GameConfig) => void;
}

export default function SetupScreen({ onStart }: Props) {
  const [playerCount, setPlayerCount] = useState(4);
  const [mode, setMode] = useState<'ai' | 'human'>('ai');
  const [selectedSchools, setSelectedSchools] = useState<string[]>([]);
  
  const toggleSchool = (school: string) => {
    setSelectedSchools((prev) =>
      prev.includes(school)
        ? prev.filter((s) => s !== school)
        : prev.length < 3
        ? [...prev, school]
        : prev
    );
  };
  
  const handleStart = () => {
    if (selectedSchools.length !== 3) {
      alert('Please select exactly 3 schools.');
      return;
    }
    
    const botTypes: GameConfig['botTypes'] = Array(playerCount).fill('strategic');
    if (mode === 'human') {
      botTypes[0] = 'human';
    }
    
    onStart({
      playerCount,
      botTypes,
      schools: selectedSchools,
      speed: 'medium',
      seed: Math.floor(Math.random() * 0xffffffff),
    });
  };
  
  return (
    <div className="setup">
      <h1 className="setup-title">Wiz-War Setup</h1>
      
      <div className="setup-row">
        <label>Players: </label>
        <select 
          value={playerCount} 
          onChange={(e) => setPlayerCount(parseInt(e.target.value, 10))}
          className="setup-select"
        >
          {[2, 3, 4].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>
      
      <div className="setup-row">
        <label>Mode: </label>
        <select 
          value={mode} 
          onChange={(e) => setMode(e.target.value as 'ai' | 'human')}
          className="setup-select"
        >
          <option value="ai">AI vs AI (Spectate)</option>
          <option value="human">Human vs AI</option>
        </select>
      </div>
      
      <div className="setup-row">
        <label>Schools (pick 3): </label>
        <div className="setup-schools">
          {CHOOSABLE_SCHOOLS.map((school) => (
            <label key={school} className="setup-school">
              <input
                type="checkbox"
                checked={selectedSchools.includes(school)}
                onChange={() => toggleSchool(school)}
              />
              <span>{school}</span>
            </label>
          ))}
        </div>
      </div>
      
      <button 
        className="setup-start" 
        onClick={handleStart}
        disabled={selectedSchools.length !== 3}
      >
        Start Game
      </button>
    </div>
  );
}