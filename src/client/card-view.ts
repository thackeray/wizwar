// Card rendering: with card images.

import type { Color, School } from '../core/types';
import { getCard } from '../core/cards/registry';

export const PLAYER_COLORS: Record<Color, string> = {
  blue: '#2563eb',
  red: '#dc2626',
  yellow: '#ca8a04',
  green: '#16a34a',
};

export const SCHOOL_COLORS: Record<School, string> = {
  cantrip: '#f5f5f5',
  alchemy: '#8b5a2b',
  conjuring: '#6b4fa0',
  elemental: '#c0392b',
  mentalism: '#2980b9',
  mutation: '#27ae60',
  thaumaturgy: '#d4a017',
};

export const SCHOOL_TEXT: Record<School, string> = {
  cantrip: '#333',
  alchemy: '#fff',
  conjuring: '#fff',
  elemental: '#fff',
  mentalism: '#fff',
  mutation: '#fff',
  thaumaturgy: '#fff',
};

export function renderCard(cardId: string, opts?: { small?: boolean }): HTMLElement {
  const card = getCard(cardId);
  const el = document.createElement('div');
  el.className = 'card' + (opts?.small ? ' card--small' : '');
  el.dataset.cardId = cardId;
  if (!card) {
    el.textContent = cardId;
    return el;
  }
  
  // Try to use card image
  const schoolDir = card.school.charAt(0).toUpperCase() + card.school.slice(1);
  let cardName = card.name;
  
  // For energy cards, try to find the matching image with energy value
  if (card.name === 'Energy' && card.energyValue > 0) {
    cardName = `Energy ${card.energyValue}`;
  }
  
  // Encode spaces in the filename
  const encodedName = cardName.replace(/ /g, '%20');
  const cardImg = `/images/cards/${schoolDir}/${encodedName}.png`;
  
  // Set image as background
  el.style.backgroundImage = `url(${cardImg})`;
  el.style.backgroundSize = 'cover';
  el.style.backgroundPosition = 'center';
  el.style.backgroundColor = SCHOOL_COLORS[card.school]; // Fallback color
  
  // Add text overlay for accessibility
  const overlay = document.createElement('div');
  overlay.className = 'card__overlay';
  
  const name = document.createElement('div');
  name.className = 'card__name';
  name.textContent = card.name;
  overlay.appendChild(name);

  // Energy value badge (blue circle) if usable as energy.
  if (card.energyValue > 0) {
    const energy = document.createElement('div');
    energy.className = 'card__energy';
    energy.textContent = String(card.energyValue);
    overlay.appendChild(energy);
  }
  
  el.appendChild(overlay);

  return el;
}

export function renderCardBack(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'card card--back';
  el.textContent = '?';
  return el;
}