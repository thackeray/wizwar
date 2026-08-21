// Card registry: built-in + custom cards, with schema validation.

import type { CardDef } from '../types';
import { validateCards } from './schema';

const registry = new Map<string, CardDef>();

export function registerCards(cards: CardDef[]): void {
  const res = validateCards(cards);
  if (!res.ok) {
    throw new Error(`Card validation failed:\n${res.errors.join('\n')}`);
  }
  for (const card of cards) {
    registry.set(card.id, card);
  }
}

export function getCard(id: string): CardDef | undefined {
  return registry.get(id);
}

export function allCards(): CardDef[] {
  return Array.from(registry.values());
}

export function cardsBySchool(school: string): CardDef[] {
  return allCards().filter((c) => c.school === school);
}

export function clearRegistry(): void {
  registry.clear();
}

// Build the game deck from chosen schools.
// Cantrip (white) is always included; plus 3 chosen schools.
export function buildDeck(schools: string[]): string[] {
  const deck: string[] = [];
  for (const school of schools) {
    for (const card of cardsBySchool(school)) {
      deck.push(card.id);
    }
  }
  return deck;
}