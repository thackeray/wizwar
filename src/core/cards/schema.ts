// Card JSON schema validation.

import type { CardDef, CardType, RangeKind, DurationKind, TargetKind } from '../types';
import { SCHOOLS } from '../types';

const CARD_TYPES: CardType[] = [
  'attack-spell',
  'counter-spell',
  'neutral-spell',
  'item',
  'energy',
  'transform',
];

const RANGE_KINDS: RangeKind[] = ['caster', 'adjacent', 'los', 'anywhere', 'same-sector'];

const DURATION_KINDS: DurationKind[] = ['instant', 'temporary', 'permanent'];

const TARGET_KINDS: TargetKind[] = [
  'wizard',
  'creature',
  'object',
  'square',
  'wall',
  'door',
  'self',
  'game-board',
  'spell',
  'line',
  'treasure',
];

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateCard(card: CardDef): ValidationResult {
  const errors: string[] = [];

  if (!card.id || typeof card.id !== 'string') {
    errors.push('Missing or invalid id');
  }
  if (!card.name || typeof card.name !== 'string') {
    errors.push('Missing or invalid name');
  }
  if (!SCHOOLS.includes(card.school)) {
    errors.push(`Invalid school: ${card.school}`);
  }
  if (!CARD_TYPES.includes(card.type)) {
    errors.push(`Invalid type: ${card.type}`);
  }
  if (typeof card.energy !== 'number' || card.energy < 0) {
    errors.push('Invalid energy');
  }
  if (!RANGE_KINDS.includes(card.range)) {
    errors.push(`Invalid range: ${card.range}`);
  }
  if (!DURATION_KINDS.includes(card.duration)) {
    errors.push(`Invalid duration: ${card.duration}`);
  }
  if (!TARGET_KINDS.includes(card.target)) {
    errors.push(`Invalid target: ${card.target}`);
  }
  if (typeof card.energyValue !== 'number' || card.energyValue < 0) {
    errors.push('Invalid energyValue');
  }
  if (!card.effect || typeof card.effect !== 'object') {
    errors.push('Missing or invalid effect');
  }

  return { ok: errors.length === 0, errors };
}

export function validateCards(cards: CardDef[]): ValidationResult {
  const allErrors: string[] = [];
  const seenIds = new Set<string>();
  for (const card of cards) {
    const res = validateCard(card);
    if (!res.ok) {
      allErrors.push(...res.errors.map((e) => `${card.id}: ${e}`));
    }
    if (seenIds.has(card.id)) {
      allErrors.push(`Duplicate card id: ${card.id}`);
    }
    seenIds.add(card.id);
  }
  return { ok: allErrors.length === 0, errors: allErrors };
}