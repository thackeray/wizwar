// Seedable RNG (mulberry32) for reproducible games.

export interface RNG {
  next(): number; // [0, 1)
  int(maxExclusive: number): number; // [0, maxExclusive)
  pick<T>(arr: T[]): T;
  shuffle<T>(arr: T[]): T[]; // returns a new shuffled array
}

export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    int(maxExclusive: number): number {
      return Math.floor(next() * maxExclusive);
    },
    pick<T>(arr: T[]): T {
      return arr[Math.floor(next() * arr.length)];
    },
    shuffle<T>(arr: T[]): T[] {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
  };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}