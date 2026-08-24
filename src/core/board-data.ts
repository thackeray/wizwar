// Convert board-data.json to the format expected by createBoardFromTopology.

import type { Color, Dir } from './types';
import type { BoardTopology, TopologyCell } from './board';

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

function buildFaceGrid(face: RawCell[][]): TopologyCell[][] {
  return face.map(row =>
    row.map(cell => ({
      kind: mapKind(cell.kind),
      walls: cell.walls,
      doors: cell.doors ? Object.fromEntries(
        Object.entries(cell.doors).filter(([_, v]) => v !== null)
      ) : undefined,
    }))
  );
}

export function convertBoardData(data: BoardDataJSON): BoardTopology {
  const sectors: BoardTopology['sectors'] = {};

  for (const color of ['blue', 'red', 'yellow', 'green'] as Color[]) {
    const face = data.faces[color];
    if (!face) continue;

    // Keep BOTH faces so the board can show the front or back (matching the
    // random `sector.side` the UI renders). Previously only front was kept,
    // so a sector showing its back image had mismatched walls.
    sectors[color] = {
      front: buildFaceGrid(face.front),
      back: buildFaceGrid(face.back),
    };
  }

  return {
    sectors,
    portals: data.portals as BoardTopology['portals'],
  };
}