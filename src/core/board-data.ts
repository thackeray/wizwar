// Convert board-data.json to the format expected by createBoardFromTopology.

import type { Color, Dir } from './types';
import type { BoardTopology } from './board';

export interface BoardDataJSON {
  faces: Record<Color, { front: RawCell[][]; back: RawCell[][] }>;
  portals: unknown[];
}

interface RawCell {
  kind?: string;
  walls?: Record<Dir, boolean>;
  doors?: Record<Dir, { color: Color; locked?: boolean } | null>;
}

function mapKind(kind?: string): 'corridor' | 'home' | 'treasure-start' | undefined {
  if (!kind) return undefined;
  if (kind === 'treasure') return 'treasure-start';
  return kind as 'corridor' | 'home' | 'treasure-start';
}

export function convertBoardData(data: BoardDataJSON): BoardTopology {
  const sectors: BoardTopology['sectors'] = {};

  for (const color of ['blue', 'red', 'yellow', 'green'] as Color[]) {
    const face = data.faces[color];
    if (!face) continue;

    // Use the front side as the main grid
    const grid = face.front.map(row =>
      row.map(cell => ({
        kind: mapKind(cell.kind),
        walls: cell.walls,
        doors: cell.doors ? Object.fromEntries(
          Object.entries(cell.doors).filter(([_, v]) => v !== null)
        ) : undefined,
      }))
    );

    sectors[color] = grid;
  }

  return {
    sectors,
    portals: data.portals as BoardTopology['portals'],
  };
}