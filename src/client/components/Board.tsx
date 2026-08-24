// Board: static 10x10 grid (sector images + walls/doors) with an overlay layer
// for wizard tokens (CSS-transitioned smooth movement) and decorations.
import type React from 'react';
import { toGlobal, toLocal, SECTOR_ORIGIN } from '../../core/board';
import type { GameState, CellRef, Color } from '../../core/types';

const SECTOR_IMAGE: Record<Color, Record<'front' | 'back', string>> = {
  blue: { front: '/images/boards/blue%20front.png', back: '/images/boards/blue%20back.png' },
  red: { front: '/images/boards/red%20front.png', back: '/images/boards/red%20back.png' },
  yellow: { front: '/images/boards/yellow%20front.png', back: '/images/boards/yellow%20back.png' },
  green: { front: '/images/boards/green%20front.png', back: '/images/boards/green%20back.png' },
};

export interface BoardProps {
  state: GameState;
  highlight: CellRef[]; // legal move targets (blue pulse)
  castTargets: CellRef[]; // spell targets for the selected card (purple)
  onCellClick: (ref: CellRef) => void;
  interactive: boolean; // whether clicks are allowed (human turn)
}

function cellKey(ref: CellRef): string {
  return `${ref.sector}:${ref.r}:${ref.c}`;
}

export default function Board({ state, highlight, castTargets, onCellClick, interactive }: BoardProps) {
  const highlightSet = new Set(highlight.map(cellKey));
  const castSet = new Set(castTargets.map(cellKey));

  const cur = state.players[state.currentPlayer];
  const curKey = cur.alive ? cellKey(cur.pos) : '';

  const cells: React.ReactNode[] = [];
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      const ref = toLocal(row, col);
      const cell = state.board.sectors[ref.sector].grid[ref.r][ref.c];
      const origin = SECTOR_ORIGIN[ref.sector];
      const localRow = row - origin.row;
      const localCol = col - origin.col;
      const sector = state.board.sectors[ref.sector];
      const img = SECTOR_IMAGE[ref.sector][sector.side];
      const key = cellKey(ref);

      const classes = ['board-cell'];
      if (cell.kind === 'home') classes.push('board-cell--home');
      if (cell.walls.N) classes.push('board-cell--wall-n');
      if (cell.walls.S) classes.push('board-cell--wall-s');
      if (cell.walls.E) classes.push('board-cell--wall-e');
      if (cell.walls.W) classes.push('board-cell--wall-w');
      if (cell.doors.N) classes.push('board-cell--door-n');
      if (cell.doors.S) classes.push('board-cell--door-s');
      if (cell.doors.E) classes.push('board-cell--door-e');
      if (cell.doors.W) classes.push('board-cell--door-w');
      if (highlightSet.has(key)) classes.push('board-cell--hl-move');
      if (castSet.has(key)) classes.push('board-cell--hl-cast');
      if (key === curKey) classes.push('board-cell--hl-current');
      if (interactive) classes.push('board-cell--clickable');

      cells.push(
        <div
          key={key}
          className={classes.join(' ')}
          style={{
            backgroundImage: `url(${img})`,
            backgroundSize: '500% 500%',
            backgroundPosition: `${localCol * 25}% ${localRow * 25}%`,
          }}
          onClick={() => interactive && onCellClick(ref)}
        >
          {cell.treasures.length > 0 && (
            <span className="board-deco board-deco--treasure">{'◆'.repeat(cell.treasures.length)}</span>
          )}
          {cell.objects.length > 0 && (
            <span className="board-deco board-deco--object">{'▪'.repeat(cell.objects.length)}</span>
          )}
        </div>,
      );
    }
  }

  // Token overlay.
  const tokens = state.players.map((p) => {
    if (!p.alive) return null;
    const g = toGlobal(p.pos);
    // Position the token CENTER at the cell center (cell spans col*10..col*10+10%).
    const left = g.col * 10 + 5;
    const top = g.row * 10 + 5;
    const badges: React.ReactNode[] = [];
    if (p.stunned) badges.push(<span key="s" className="token-badge" title="Stunned">⚡</span>);
    if (p.carriedTreasure !== null) badges.push(<span key="t" className="token-badge" title="Carrying treasure">◆</span>);
    if (p.transformed) badges.push(<span key="x" className="token-badge" title="Transformed">🔄</span>);
    return (
      <div
        key={p.id}
        className={`token token--${p.color}${p.id === cur.id ? ' token--current' : ''}`}
        style={{ left: `${left}%`, top: `${top}%` }}
      >
        {p.id + 1}
        {badges}
      </div>
    );
  });

  return (
    <div className="board">
      {cells}
      <div className="token-layer">{tokens}</div>
    </div>
  );
}
