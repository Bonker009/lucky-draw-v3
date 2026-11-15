/**
 * Where the stage's floating gems go.
 *
 * Decoration only, so it has its own tiny PRNG — never `lib/domain/rng.ts`,
 * whose nonces the event log depends on. Deterministic per seed: each view
 * ("stage", "photo") gets its own arrangement, and the same one every time it
 * is shown, rather than gems jumping about on a re-render.
 *
 * Coordinates are in a 1920×1080 reference frame; the component converts them
 * to percentages of the screen.
 */

export const REF_W = 1920;
export const REF_H = 1080;

export interface KeepRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
/** Rectangles no gem or sparkle may be centred in. */
export type KeepOut = readonly KeepRect[];

/**
 * The middle of the stage belongs to names, and so does the top centre:
 * the envelope's caption and the letter reels' counts sit up there, and a
 * centre-only keep-out let gems float over them.
 */
export const KEEP_OUT: KeepOut = [{ x0: 380, x1: 1540, y0: -1, y1: 880 }];

/**
 * The name wall is not a centred block: its columns run from the left edge
 * to the winners rail, count line included, and the rail's heading and
 * newest winners sit at its top. Gems go down the rail's lower half.
 */
export const WALL_KEEP_OUT: KeepOut = [
  { x0: -1, x1: 1560, y0: 30, y1: 1100 },
  { x0: 1540, x1: 1921, y0: -1, y1: 340 },
];

export const GEM_KINDS = [
  "hero",
  "shard",
  "tourmaline",
  "tanzanite",
  "amethyst",
  "garnet",
  "wire",
  "wire2",
] as const;
export type GemKind = (typeof GEM_KINDS)[number];

/** Biggest first, so the large gems get first pick of the free space. */
const SIZES = [240, 190, 160, 140, 120, 110, 95, 84];
const SPARKS = 24;

export interface PlacedGem {
  kind: GemKind;
  x: number;
  y: number;
  size: number;
  rotate: number;
  /** Colour family, 0–3. */
  family: number;
  /** Float height in px of the reference frame. */
  amp: number;
  durationMs: number;
  /** Negative, so gems start mid-float and out of step with each other. */
  delayMs: number;
}

export interface PlacedSpark {
  x: number;
  y: number;
  size: number;
  /** Index into the palette's spark colours. */
  tone: number;
  durationMs: number;
  delayMs: number;
}

/** mulberry32 over an FNV-1a hash of the seed. */
function prng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function inKeepOut(cx: number, cy: number, k: KeepOut = KEEP_OUT) {
  return k.some((r) => cx > r.x0 && cx < r.x1 && cy > r.y0 && cy < r.y1);
}

/**
 * Gems that find no free spot outside the keep-out are left out rather than
 * forced over the names, so a large keep-out simply means fewer gems.
 */
export function layoutGems(seed: string, keepOut: KeepOut = KEEP_OUT, sparkCount = SPARKS) {
  const rand = prng(seed);
  const between = (a: number, b: number) => a + rand() * (b - a);

  // Every kind once, in a random order; any extra slots pick at random.
  const order: GemKind[] = [...GEM_KINDS];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const placed: { cx: number; cy: number; r: number }[] = [];
  const gems: PlacedGem[] = [];
  SIZES.forEach((size, i) => {
    const kind = order[i] ?? GEM_KINDS[Math.floor(rand() * GEM_KINDS.length)];
    for (let tries = 0; tries < 80; tries++) {
      const x = between(10, REF_W - size - 10);
      const y = between(10, REF_H - size - 10);
      const cx = x + size / 2;
      const cy = y + size / 2;
      if (inKeepOut(cx, cy, keepOut)) continue;
      const clear = placed.every(
        (p) => Math.hypot(p.cx - cx, p.cy - cy) > (p.r + size / 2) * 0.95,
      );
      if (!clear) continue;
      placed.push({ cx, cy, r: size / 2 });
      gems.push({
        kind,
        x: Math.round(x),
        y: Math.round(y),
        size,
        rotate: Math.round(between(-24, 24)),
        family: Math.floor(rand() * 4),
        amp: Math.round(between(10, 24)),
        durationMs: Math.round(between(4300, 6000)),
        delayMs: -Math.round(between(0, 4000)),
      });
      return;
    }
    // No room found: leave it out rather than drop it over the names.
  });

  const sparks: PlacedSpark[] = [];
  for (let tries = 0; sparks.length < sparkCount && tries < sparkCount * 20; tries++) {
    const x = Math.round(between(10, REF_W - 30));
    const y = Math.round(between(10, REF_H - 30));
    if (inKeepOut(x, y, keepOut)) continue;
    sparks.push({
      x,
      y,
      size: Math.round(between(12, 26)),
      tone: sparks.length,
      durationMs: Math.round(between(3500, 7500)),
      delayMs: -Math.round(between(0, 6000)),
    });
  }

  return { gems, sparks };
}
