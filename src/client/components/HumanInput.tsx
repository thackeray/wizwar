// Human input component for interactive gameplay
import React, { useState } from 'react';
import type { GameState, Action } from '../../core/types';
import { getLegalActions } from '../../core/ai/bots';

interface Props {
  state: GameState;
  onAction: (action: Action) => void;
}

export default function HumanInput({ state, onAction }: Props) {
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [highlightedCells, setHighlightedCells] = useState<Set<string>>(new Set());
  
  const currentPlayer = state.players[state.currentPlayer];
  const legalActions = getLegalActions(state, currentPlayer.id);
  
  const handleCardClick = (cardId: string) => {
    setSelectedCard(selectedCard === cardId ? null : cardId);
    
    // Highlight legal targets for this card
    if (selectedCard !== cardId) {
      const targets = legalActions
        .filter((a) => a.type === 'cast' && a.cardId === cardId)
        .map((a) => a.target)
        .filter((t): t is NonNullable<typeof t> => t !== null);
      
      setHighlightedCells(new Set(targets.map((t) => `${t.sector}-${t.r}-${t.c}`)));
    } else {
      setHighlightedCells(new Set());
    }
  };
  
  const handleCellClick = (sector: string, r: number, c: number) => {
    if (!selectedCard) return;
    
    // Find matching action
    const action = legalActions.find(
      (a) => 
        a.type === 'cast' && 
        a.cardId === selectedCard &&
        a.target?.sector === sector &&
        a.target?.r === r &&
        a.target?.c === c
    );
    
    if (action) {
      onAction(action);
      setSelectedCard(null);
      setHighlightedCells(new Set());
    }
  };
  
  const handleMoveClick = (dir: 'N' | 'S' | 'E' | 'W') => {
    const action = legalActions.find((a) => a.type === 'move' && a.dir === dir);
    if (action) {
      onAction(action);
    }
  };
  
  const handleEndTurn = () => {
    const action = legalActions.find((a) => a.type === 'end-turn');
    if (action) {
      onAction(action);
    }
  };
  
  return (
    <div className="human-input">
      <div className="human-input__title">Your Turn</div>
      
      <div className="human-input__actions">
        <button onClick={() => handleMoveClick('N')} disabled={!legalActions.some((a) => a.type === 'move' && a.dir === 'N')}>
          Move North
        </button>
        <button onClick={() => handleMoveClick('S')} disabled={!legalActions.some((a) => a.type === 'move' && a.dir === 'S')}>
          Move South
        </button>
        <button onClick={() => handleMoveClick('E')} disabled={!legalActions.some((a) => a.type === 'move' && a.dir === 'E')}>
          Move East
        </button>
        <button onClick={() => handleMoveClick('W')} disabled={!legalActions.some((a) => a.type === 'move' && a.dir === 'W')}>
          Move West
        </button>
        <button onClick={handleEndTurn}>
          End Turn
        </button>
      </div>
      
      <div className="human-input__hint">
        {selectedCard 
          ? 'Select a target cell on the board'
          : 'Select a card from your hand to cast a spell'}
      </div>
    </div>
  );
}