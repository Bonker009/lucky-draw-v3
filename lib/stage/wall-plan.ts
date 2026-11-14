/**
 * The knock-out schedule for the name wall.
 *
 * Presentation only. The winner is chosen and committed by `computeDraw`
 * before the wall starts; this decides nothing but the order in which the
 * *other* names fade out on the way there. Three properties matter, and the
 * unit tests pin each one:
 *
 * - The committed winner is never knocked out. The wall reveals a pick, it
 *   never makes one — if it could eliminate the winner, the projector would
 *   be able to contradict the log.
 * - Every round leaves ceil(alive / 2) standing, so the count the audience is
 *   shown ("31 still in") is exactly what the next frame draws.
 * - It is deterministic for a given (pool, winner). A reload or a rehearsal
 *   replay of the same draw knocks the same names out in the same order, so
 *   the show is reproducible the way the draw itself is.
 *
 * Deliberately not `lib/domain/rng.ts`: that generator is the fairness
 * mechanism, and drawing presentation randomness from it would consume or
 * entangle nonces the log depends on. A small local PRNG keyed off the
 * winner id cannot affect any committed result.
 */

export interface WallPlan {
  /** Number of knock-out rounds; 0 when the pool is a single name. */
  rounds: number;
  /**
   * For each pool index, the round (1-based) in which it is knocked out.
   * The winner holds `rounds + 1`: never out.
   */
  outRound: Uint16Array;
  /** How many are still in after each round, index 0 = before round 1. */
  aliveAfter: number[];
}

/** FNV-1a, enough to turn an id into a 32-bit seed. */
function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: tiny, fast, good enough for shuffling a display order. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function planWall(
  poolSize: number,
  winnerIndex: number,
  seedKey: string,
): WallPlan {
  if (poolSize < 1) throw new Error("planWall: empty pool");
  if (winnerIndex < 0 || winnerIndex >= poolSize) {
    throw new Error("planWall: winner is not in the pool");
  }

  const aliveAfter = [poolSize];
  while (aliveAfter[aliveAfter.length - 1] > 1) {
    aliveAfter.push(Math.ceil(aliveAfter[aliveAfter.length - 1] / 2));
  }
  const rounds = aliveAfter.length - 1;

  // Shuffle everyone except the winner once, then hand out knock-out rounds
  // in that order: the first batch goes in round 1, the next in round 2…
  const others: number[] = [];
  for (let i = 0; i < poolSize; i++) if (i !== winnerIndex) others.push(i);
  const rand = mulberry32(hash32(`${seedKey}:${poolSize}`));
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }

  const outRound = new Uint16Array(poolSize);
  outRound[winnerIndex] = rounds + 1;
  let cursor = 0;
  for (let r = 1; r <= rounds; r++) {
    const knocked = aliveAfter[r - 1] - aliveAfter[r];
    for (let k = 0; k < knocked; k++) outRound[others[cursor++]] = r;
  }
  return { rounds, outRound, aliveAfter };
}

/**
 * When each round ends, as a fraction of the whole run (0–1].
 *
 * Later rounds get more time: the first sweeps take a crowd from hundreds to
 * dozens and can be quick, but the last two — four names, then two — are the
 * part the room is actually watching, and rushing them wastes the suspense.
 */
export function roundEnds(rounds: number): number[] {
  if (rounds === 0) return [];
  const weights = Array.from({ length: rounds }, (_, i) => {
    const fromEnd = rounds - i; // 1 for the final round
    return fromEnd === 1 ? 3 : fromEnd === 2 ? 2 : 1;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  return weights.map((w) => (acc += w) / total);
}
