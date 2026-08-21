// Card rendering: pure HTML/CSS, no card images.

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
  const bg = SCHOOL_COLORS[card.school];
  const fg = SCHOOL_TEXT[card.school];
  el.style.background = bg;
  el.style.color = fg;

  const name = document.createElement('div');
  name.className = 'card__name';
  name.textContent = card.name;
  el.appendChild(name);

  const school = document.createElement('div');
  school.className = 'card__school';
  school.textContent = card.school;
  el.appendChild(school);

  const text = document.createElement('div');
  text.className = 'card__text';
  text.textContent = card.text;
  el.appendChild(text);

  // Energy value badge (blue circle) if usable as energy.
  if (card.energyValue > 0) {
    const energy = document.createElement('div');
    energy.className = 'card__energy';
    energy.textContent = String(card.energyValue);
    el.appendChild(energy);
  }

  return el;
}

export function renderCardBack(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'card card--back';
  el.textContent = '?';
  return el;
}