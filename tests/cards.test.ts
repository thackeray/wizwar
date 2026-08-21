import { describe, it, expect } from 'vitest';
import { validateCard, validateCards } from '../src/core/cards/schema';
import { loadBuiltInCards } from '../src/core/cards';
import { allCards } from '../src/core/cards/registry';
import type { CardDef } from '../src/core/types';

describe('card schema validation', () => {
  it('validates a correct card', () => {
    const card: CardDef = {
      id: 'test-card',
      name: 'Test Card',
      school: 'cantrip',
      type: 'attack-spell',
      energy: 1,
      range: 'los',
      duration: 'instant',
      target: 'wizard',
      energyValue: 0,
      text: 'Test card text',
      effect: { op: 'damage', amount: 2, kind: 'magical' },
    };
    const res = validateCard(card);
    expect(res.ok).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('rejects a card with missing id', () => {
    const card: CardDef = {
      id: '',
      name: 'Test Card',
      school: 'cantrip',
      type: 'attack-spell',
      energy: 1,
      range: 'los',
      duration: 'instant',
      target: 'wizard',
      energyValue: 0,
      text: 'Test',
      effect: { op: 'damage' },
    };
    const res = validateCard(card);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes('id'))).toBe(true);
  });

  it('rejects a card with invalid school', () => {
    const card: CardDef = {
      id: 'test-card',
      name: 'Test Card',
      school: 'invalid-school' as any,
      type: 'attack-spell',
      energy: 1,
      range: 'los',
      duration: 'instant',
      target: 'wizard',
      energyValue: 0,
      text: 'Test',
      effect: { op: 'damage' },
    };
    const res = validateCard(card);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes('school'))).toBe(true);
  });

  it('rejects duplicate card ids', () => {
    const card1: CardDef = {
      id: 'dup-card',
      name: 'Card 1',
      school: 'cantrip',
      type: 'attack-spell',
      energy: 1,
      range: 'los',
      duration: 'instant',
      target: 'wizard',
      energyValue: 0,
      text: 'Test',
      effect: { op: 'damage' },
    };
    const card2: CardDef = { ...card1, name: 'Card 2' };
    const res = validateCards([card1, card2]);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes('Duplicate'))).toBe(true);
  });

  it('validates all built-in cards', () => {
    loadBuiltInCards();
    const cards = allCards();
    expect(cards.length).toBeGreaterThan(0);
    const res = validateCards(cards);
    expect(res.ok).toBe(true);
    if (!res.ok) {
      console.error('Validation errors:', res.errors);
    }
  });

  it('has cards from all 7 schools', () => {
    loadBuiltInCards();
    const cards = allCards();
    const schools = new Set(cards.map((c) => c.school));
    expect(schools.size).toBe(7);
    for (const school of ['cantrip', 'alchemy', 'conjuring', 'elemental', 'mentalism', 'mutation', 'thaumaturgy']) {
      expect(schools.has(school as any)).toBe(true);
    }
  });
});