/** Deterministic PRNG for db-spec event sequences (mulberry32). Never for app money. */
export function seededRandom(seed: number) {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const index = (n: number): number => Math.floor(next() * n);
  return {
    index,
    pick: <T>(xs: T[]): T => xs[index(xs.length)],
    /** A positive amount 1.00–400.99 as a scale-2 string. */
    cash: (): string => `${1 + index(400)}.${String(index(100)).padStart(2, '0')}`,
  };
}
