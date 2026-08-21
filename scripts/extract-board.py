#!/usr/bin/env python3
"""Extract board topology from a Wiz-War sector tile image.

Best-effort computer vision: finds the board quadrilateral, warps it to a
square, divides into an 8x8 grid, and classifies each cell edge as wall/door
and each cell as home/treasure/corridor. Output is a BoardTopology JSON that
src/core/board.ts (createBoardFromTopology) can consume.

NOTE: This is a starting point. Photos of physical tiles have perspective and
lighting variation, so results should be spot-checked and corrected by hand.
The vision model (port 6999) can be used to assist if the GPU is free.

Usage:
  python3 scripts/extract-board.py <image.png> [--out board-data.json]
"""
import argparse
import json
import sys

import cv2
import numpy as np

GRID = 8
OUT_SIZE = 1024


def find_board_quad(gray):
    """Find the largest quadrilateral contour (the board frame)."""
    blur = cv2.GaussianBlur(gray, (7, 7), 0)
    edges = cv2.Canny(blur, 40, 120)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=2)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    best = None
    best_area = 0
    for c in contours:
        area = cv2.contourArea(c)
        if area < gray.shape[0] * gray.shape[1] * 0.3:
            continue
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        if len(approx) == 4 and area > best_area:
            best, best_area = approx, area
    if best is not None:
        return best.reshape(4, 2).astype(np.float32)
    # Fallback: use the bounding box of the largest contour.
    largest = max(contours, key=cv2.contourArea)
    x, y, w, h = cv2.boundingRect(largest)
    return np.array([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], np.float32)


def order_points(pts):
    """Order points as top-left, top-right, bottom-right, bottom-left."""
    rect = np.zeros((4, 2), np.float32)
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    d = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(d)]
    rect[3] = pts[np.argmax(d)]
    return rect


def warp_board(img, quad):
    rect = order_points(quad)
    (tl, tr, br, bl) = rect
    width = int(max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl)))
    height = int(max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr)))
    dst = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], np.float32)
    M = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(img, M, (OUT_SIZE, OUT_SIZE))


def cell_center(r, c):
    return (int((c + 0.5) * OUT_SIZE / GRID), int((r + 0.5) * OUT_SIZE / GRID))


def is_dark(img, x, y, half=6, thresh=90):
    """Sample a small region; return True if mostly dark (a wall line)."""
    x0, x1 = max(0, x - half), min(OUT_SIZE, x + half)
    y0, y1 = max(0, y - half), min(OUT_SIZE, y + half)
    region = img[y0:y1, x0:x1]
    gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
    return (gray < thresh).mean() > 0.5


def is_colored(img, x, y, half=6):
    """Sample a region; return (is_colored, dominant_color) for doors."""
    x0, x1 = max(0, x - half), min(OUT_SIZE, x + half)
    y0, y1 = max(0, y - half), min(OUT_SIZE, y + half)
    region = img[y0:y1, x0:x1]
    hsv = cv2.cvtColor(region, cv2.COLOR_BGR2HSV)
    sat = hsv[:, :, 1].mean()
    if sat < 60:
        return False, None
    # Classify dominant hue.
    hue = hsv[:, :, 0].mean()
    if 100 <= hue <= 130:
        return True, 'blue'
    if hue < 10 or hue > 170:
        return True, 'red'
    if 20 <= hue < 35:
        return True, 'yellow'
    if 35 <= hue < 85:
        return True, 'green'
    return True, 'blue'


def extract(image_path):
    img = cv2.imread(image_path)
    if img is None:
        print(f'Error: cannot read {image_path}', file=sys.stderr)
        sys.exit(1)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    quad = find_board_quad(gray)
    board = warp_board(img, quad)

    sectors = {}
    color = guess_sector_color(board)
    grid = []
    for r in range(GRID):
        row = []
        for c in range(GRID):
            cx, cy = cell_center(r, c)
            cell = {}
            # Home base: large colored region (check saturation in cell).
            if is_home(board, r, c):
                cell['kind'] = 'home'
            # Walls on each side.
            walls = {}
            doors = {}
            for d, (dx, dy) in {'N': (0, -1), 'S': (0, 1), 'E': (1, 0), 'W': (-1, 0)}.items():
                ex, ey = cx + dx * (OUT_SIZE // GRID // 2), cy + dy * (OUT_SIZE // GRID // 2)
                if 0 <= ex < OUT_SIZE and 0 <= ey < OUT_SIZE:
                    colored, col = is_colored(board, ex, ey)
                    if colored:
                        doors[d] = {'color': col}
                    elif is_dark(board, ex, ey):
                        walls[d] = True
            if walls:
                cell['walls'] = walls
            if doors:
                cell['doors'] = doors
            row.append(cell)
        grid.append(row)
    sectors[color] = grid
    return {'sectors': sectors, 'portals': []}


def guess_sector_color(board):
    """Guess the sector color from the most saturated region."""
    hsv = cv2.cvtColor(board, cv2.COLOR_BGR2HSV)
    mask = hsv[:, :, 1] > 100
    if mask.sum() == 0:
        return 'blue'
    hues = hsv[:, :, 0][mask]
    hue = hues.mean()
    if 100 <= hue <= 130:
        return 'blue'
    if hue < 10 or hue > 170:
        return 'red'
    if 20 <= hue < 35:
        return 'yellow'
    return 'green'


def is_home(board, r, c):
    """Heuristic: home base is a large saturated region near a corner."""
    x0 = int(c * OUT_SIZE / GRID)
    y0 = int(r * OUT_SIZE / GRID)
    x1 = int((c + 1) * OUT_SIZE / GRID)
    y1 = int((r + 1) * OUT_SIZE / GRID)
    region = board[y0:y1, x0:x1]
    hsv = cv2.cvtColor(region, cv2.COLOR_BGR2HSV)
    sat_frac = (hsv[:, :, 1] > 120).mean()
    # Home base cells are highly saturated.
    return sat_frac > 0.4


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('image')
    ap.add_argument('--out', default=None)
    args = ap.parse_args()
    topo = extract(args.image)
    out = json.dumps(topo, indent=2)
    if args.out:
        with open(args.out, 'w') as f:
            f.write(out)
        print(f'Wrote {args.out}')
    else:
        print(out)


if __name__ == '__main__':
    main()