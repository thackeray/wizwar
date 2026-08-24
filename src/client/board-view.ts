// Board rendering: 10x10 grid (4 sectors of 5x5), tokens, click handling.

import type { GameState, CellRef, Color } from '../core/types';
import { toGlobal, toLocal, SECTOR_ORIGIN } from '../core/board';

const SECTOR_IMAGE: Record<Color, Record<'front' | 'back', string>> = {
  blue: {
    front: '/images/boards/blue%20front.png',
    back: '/images/boards/blue%20back.png',
  },
  red: {
    front: '/images/boards/red%20front.png',
    back: '/images/boards/red%20back.png',
  },
  yellow: {
    front: '/images/boards/yellow%20front.png',
    back: '/images/boards/yellow%20back.png',
  },
  green: {
    front: '/images/boards/green%20front.png',
    back: '/images/boards/green%20back.png',
  },
};

const PLAYER_TOKEN: Record<Color, string> = {
  blue: '#2563eb',
  red: '#dc2626',
  yellow: '#ca8a04',
  green: '#16a34a',
};

export interface BoardViewOptions {
  onCellClick: (ref: CellRef) => void;
  highlight?: CellRef[]; // legal move targets
  selectedCard?: string | null;
}

export function renderBoard(
  state: GameState,
  container: HTMLElement,
  opts: BoardViewOptions,
): void {
  container.innerHTML = '';
  const board = document.createElement('div');
  board.className = 'board';
  board.style.gridTemplateColumns = `repeat(10, 1fr)`;

  const highlightSet = new Set(
    (opts.highlight ?? []).map((r) => `${r.sector}:${r.r}:${r.c}`),
  );

  // Build a map of global (row,col) -> players there.
  const playersAt = new Map<string, number[]>();
  for (const p of state.players) {
    if (!p.alive) continue;
    const g = toGlobal(p.pos);
    const key = `${g.row}:${g.col}`;
    const arr = playersAt.get(key) ?? [];
    arr.push(p.id);
    playersAt.set(key, arr);
  }

  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      const ref = toLocal(row, col);
      const cell = state.board.sectors[ref.sector].grid[ref.r][ref.c];
      const el = document.createElement('div');
      el.className = 'board__cell';
      
      // Use sector image as background (based on selected side)
      const origin = SECTOR_ORIGIN[ref.sector];
      const localRow = row - origin.row;
      const localCol = col - origin.col;
      const sector = state.board.sectors[ref.sector];
      const img = SECTOR_IMAGE[ref.sector][sector.side];
      el.style.backgroundImage = `url(${img})`;
      el.style.backgroundSize = '500% 500%';
      el.style.backgroundPosition = `${localCol * 25}% ${localRow * 25}%`;
      
      el.dataset.row = String(row);
      el.dataset.col = String(col);

      if (cell.kind === 'home') {
        el.classList.add('board__cell--home');
      }

      // Wall indicators
      if (cell.walls.N) el.classList.add('board__cell--wall-n');
      if (cell.walls.S) el.classList.add('board__cell--wall-s');
      if (cell.walls.E) el.classList.add('board__cell--wall-e');
      if (cell.walls.W) el.classList.add('board__cell--wall-w');

      // Door indicators
      if (cell.doors.N) el.classList.add('board__cell--door-n');
      if (cell.doors.S) el.classList.add('board__cell--door-s');
      if (cell.doors.E) el.classList.add('board__cell--door-e');
      if (cell.doors.W) el.classList.add('board__cell--door-w');

      // Treasure markers.
      if (cell.treasures.length > 0) {
        const t = document.createElement('div');
        t.className = 'board__treasure';
        t.textContent = '◆'.repeat(cell.treasures.length);
        el.appendChild(t);
      }

      // Objects.
      if (cell.objects.length > 0) {
        const o = document.createElement('div');
        o.className = 'board__object';
        o.textContent = '▪'.repeat(cell.objects.length);
        el.appendChild(o);
      }

      // Player tokens.
      const pids = playersAt.get(`${row}:${col}`);
      if (pids && pids.length > 0) {
        const tokens = document.createElement('div');
        tokens.className = 'board__tokens';
        for (const pid of pids) {
          const p = state.players[pid];
          const tok = document.createElement('div');
          tok.className = 'board__token';
          tok.style.background = PLAYER_TOKEN[p.color];
          tok.textContent = String(pid + 1);
          if (p.stunned) tok.classList.add('board__token--stunned');
          tokens.appendChild(tok);
        }
        el.appendChild(tokens);
      }

      // Highlight legal moves.
      if (highlightSet.has(`${ref.sector}:${ref.r}:${ref.c}`)) {
        el.classList.add('board__cell--highlight');
      }

      // Current player position marker.
      const cur = state.players[state.currentPlayer];
      if (cur.alive && cur.pos.sector === ref.sector && cur.pos.r === ref.r && cur.pos.c === ref.c) {
        el.classList.add('board__cell--current');
      }

      el.addEventListener('click', () => opts.onCellClick(ref));
      board.appendChild(el);
    }
  }

  container.appendChild(board);
}