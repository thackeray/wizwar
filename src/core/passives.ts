// Magic stone passives and other passive effects.

import type { GameState } from './types';
import { getCard } from './cards/registry';
import { MAX_HAND_SIZE } from './state';

export interface Passives {
  lifestone: boolean;      // +1 HP at turn start (max 20)
  spellstone: boolean;     // +1 draw per turn
  speedstone: boolean;     // +1 base speed
  powerstone: boolean;     // +1 fuel energy
  brainstone: boolean;     // +2 hand size
  mightstone: boolean;     // Punch extra damage = die roll
  visionstone: boolean;    // Can see through 1 wall/door
  nullPowder: boolean;     // Can discard as counter
}

export function getPassives(state: GameState, playerId: number): Passives {
  const p = state.players.find((pl) => pl.id === playerId);
  if (!p) return emptyPassives();

  const passives = emptyPassives();

  // Check carried items
  for (const itemId of p.carriedItems) {
    const card = getCard(itemId);
    if (!card) continue;

    switch (itemId) {
      case 'alchemy-lifestone':
        passives.lifestone = true;
        break;
      case 'alchemy-spellstone':
        passives.spellstone = true;
        break;
      case 'alchemy-speedstone':
        passives.speedstone = true;
        break;
      case 'alchemy-powerstone':
        passives.powerstone = true;
        break;
      case 'alchemy-brainstone':
        passives.brainstone = true;
        break;
      case 'alchemy-mightstone':
        passives.mightstone = true;
        break;
      case 'alchemy-visionstone':
        passives.visionstone = true;
        break;
      case 'alchemy-null-powder':
        passives.nullPowder = true;
        break;
    }
  }

  return passives;
}

function emptyPassives(): Passives {
  return {
    lifestone: false,
    spellstone: false,
    speedstone: false,
    powerstone: false,
    brainstone: false,
    mightstone: false,
    visionstone: false,
    nullPowder: false,
  };
}

// Apply Lifestone passive at turn start
export function applyLifestone(state: GameState, playerId: number): void {
  const passives = getPassives(state, playerId);
  if (!passives.lifestone) return;

  const p = state.players.find((pl) => pl.id === playerId);
  if (!p || !p.alive) return;

  if (p.life < 20) {
    p.life += 1;
  }
}

// Get modified hand size (Brainstone)
export function getHandSize(state: GameState, playerId: number): number {
  const passives = getPassives(state, playerId);
  return MAX_HAND_SIZE + (passives.brainstone ? 2 : 0);
}

// Get modified base speed (Speedstone + Transform)
export function getBaseSpeed(state: GameState, playerId: number): number {
  const p = state.players.find((pl) => pl.id === playerId);
  if (!p) return 3;
  
  // Check for transform first.
  if (p.transformed) {
    const card = getCard(p.transformed);
    if (card && card.baseSpeed !== undefined) {
      return card.baseSpeed;
    }
  }
  
  const passives = getPassives(state, playerId);
  const baseSpeed = 3;
  return baseSpeed + (passives.speedstone ? 1 : 0);
}

// Get modified fuel energy (Powerstone)
export function getFuelEnergy(state: GameState, playerId: number, baseEnergy: number): number {
  const passives = getPassives(state, playerId);
  return baseEnergy + (passives.powerstone ? 1 : 0);
}

// Get modified draw count (Spellstone)
export function getDrawCount(state: GameState, playerId: number, baseCount: number): number {
  const passives = getPassives(state, playerId);
  return baseCount + (passives.spellstone ? 1 : 0);
}

// Check if a player has Visionstone (can see through 1 wall/door)
export function hasVisionstone(state: GameState, playerId: number): boolean {
  const passives = getPassives(state, playerId);
  return passives.visionstone;
}