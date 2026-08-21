// Load and register all built-in cards.

import type { CardDef } from '../types';
import { registerCards } from './registry';

import cantrip from './data/cantrip.json';
import alchemy from './data/alchemy.json';
import conjuring from './data/conjuring.json';
import elemental from './data/elemental.json';
import mentalism from './data/mentalism.json';
import mutation from './data/mutation.json';
import thaumaturgy from './data/thaumaturgy.json';

let loaded = false;

export function loadBuiltInCards(): void {
  if (loaded) return;
  const all: CardDef[] = [
    ...(cantrip as CardDef[]),
    ...(alchemy as CardDef[]),
    ...(conjuring as CardDef[]),
    ...(elemental as CardDef[]),
    ...(mentalism as CardDef[]),
    ...(mutation as CardDef[]),
    ...(thaumaturgy as CardDef[]),
  ];
  registerCards(all);
  loaded = true;
}