// Board rendering: 16x16 grid (4 sectors of 8x8), tokens, click handling.

import type { GameState, CellRef, Color } from '../core/types';
import { toGlobal, toLocal } from '../core/board';

const SECTOR_BG: Record<Color, string> = {
  blue: '#dbeafe',
  red: '#fee2e2',
  yellow: '#fef9c3',
  green: '#dcfce7',
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
  board.style.gridTemplateColumns = `repeat(16, 1fr)`;

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

  for (let row = 0; row < 16; row++) {
    for (let col = 0; col < 16; col++) {
      const ref = toLocal(row, col);
      const cell = state.board.sectors[ref.sector].grid[ref.r][ref.c];
      const el = document.createElement('div');
      el.className = 'board__cell';
      el.style.background = SECTOR_BG[ref.sector];
      el.dataset.row = String(row);
      el.dataset.col = String(col);

      if (cell.kind === 'home') {
        el.classList.add('board__cell--home');
      }

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