/**
 * Deterministic, seedable randomness.
 *
 * v2 called Math.random() inside the animation component, so a draw could
 * never be reproduced or audited. Here every pick is a pure function of
 * (seed, nonce), which means the whole event can be replayed afterwards and
 * verified against the commitment published beforehand.
 */

/** FNV-1a over a string, used only to spread a seed into the PCG state. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * PCG-XSH-RR 32-bit. Small, fast, and far better distributed than the
 * xorshift one-liners usually pasted into this kind of app.
 */
export class Rng {
  #state: bigint;
  readonly #inc: bigint;

  constructor(seed: string, nonce: number) {
    const a = BigInt(fnv1a(seed));
    const b = BigInt(fnv1a(`${seed}:${nonce}`));
    this.#inc = ((BigInt(nonce) << 1n) | 1n) & 0xffffffffffffffffn;
    this.#state = 0n;
    this.#step();
    this.#state = (this.#state + ((a << 32n) | b)) & 0xffffffffffffffffn;
    this.#step();
  }

  #step() {
    this.#state =
      (this.#state * 6364136223846793005n + this.#inc) & 0xffffffffffffffffn;
  }

  /** Next uniform 32-bit unsigned integer. */
  next(): number {
    const old = this.#state;
    this.#step();
    const xorshifted = Number(((old >> 18n) ^ old) >> 27n) >>> 0;
    const rot = Number(old >> 59n);
    return (((xorshifted >>> rot) | (xorshifted << ((-rot >>> 0) & 31))) >>> 0);
  }

  /**
   * Uniform integer in [0, bound) with rejection sampling.
   *
   * The naive `next() % bound` is biased whenever bound does not divide 2^32 —
   * with 500 participants the bias is tiny but it is exactly the kind of thing
   * you cannot defend if someone challenges a result.
   */
  nextBelow(bound: number): number {
    if (!Number.isInteger(bound) || bound <= 0) {
      throw new RangeError(`bound must be a positive integer, got ${bound}`);
    }
    const threshold = (0x100000000 % bound) >>> 0;
    for (;;) {
      const value = this.next();
      if (value >= threshold) return value % bound;
    }
  }
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The pre-event commitment: a hash over the seed, the exact roster and the
 * exact prize manifest. Publish it before drawing. Afterwards anyone can
 * recompute it, replay the log, and confirm the results were fixed in advance
 * and that nobody was added, removed or reordered along the way.
 */
export async function computeCommitment(input: {
  seed: string;
  participantIds: string[];
  prizes: { id: string; name: string; quantity: number }[];
}): Promise<string> {
  const roster = [...input.participantIds].sort().join(",");
  const manifest = [...input.prizes]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((p) => `${p.id}:${p.name}:${p.quantity}`)
    .join(",");
  return sha256Hex(`v3|${input.seed}|${roster}|${manifest}`);
}

/** A seed that is unguessable but short enough to read aloud in groups. */
export function generateSeed(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .replace(/(.{4})(?=.)/g, "$1-");
}
