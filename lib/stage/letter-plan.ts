/**
 * The narrowing plan for the "letters" draw style.
 *
 * Letter reels lock the winner's first characters one at a time, and the
 * room watches the field shrink ("248 in the draw → 31 start with S → 6 start
 * with So"). Once few enough are left to read, a name reel turns slowly
 * through just those names and stops on the winner.
 *
 * Presentation only, like the wall: the winner was committed before any of
 * this runs. What has to hold, and what the tests pin:
 *
 * - Every locked letter is the winner's own, so the reels can only ever
 *   narrow towards the committed result, never away from it.
 * - Every count shown is the true number of people sharing that prefix — the
 *   audience is told "6 start with So", so it had better be six.
 * - The finalists on the name reel all share the prefix, and always include
 *   the winner.
 *
 * Characters are compared as grapheme clusters, case-insensitively, so a
 * Khmer name narrows on its first consonant cluster rather than on a stray
 * combining mark.
 */

export interface LetterEntry {
  id: string;
  name: string;
}

export interface LetterPlan {
  /** The locked prefix characters, in order, as displayed. */
  letters: string[];
  /** counts[0] is the whole pool; counts[i] is how many share letters[0..i). */
  counts: number[];
  /** The names the final reel turns through; includes the winner. */
  finalists: LetterEntry[];
  /** Index of the winner in `finalists`. */
  winner: number;
}

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

export function graphemes(text: string): string[] {
  const t = text.trim();
  if (segmenter) return Array.from(segmenter.segment(t), (s) => s.segment);
  return Array.from(t);
}

function prefixKey(name: string, k: number): string {
  return graphemes(name).slice(0, k).join("").toLocaleUpperCase();
}

/** FNV-1a then a tiny LCG: a display shuffle that cannot touch the log. */
function shuffleSeeded<T>(items: T[], key: string): T[] {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let s = h >>> 0;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function planLetters(
  pool: LetterEntry[],
  targetId: string,
  { maxFinalists = 10, maxLetters = 3 } = {},
): LetterPlan {
  const target = pool.find((p) => p.id === targetId);
  if (!target) throw new Error("planLetters: winner is not in the pool");

  const chars = graphemes(target.name);
  const letters: string[] = [];
  const counts = [pool.length];
  let field = pool;

  while (
    field.length > maxFinalists &&
    letters.length < Math.min(maxLetters, chars.length)
  ) {
    const k = letters.length + 1;
    const key = prefixKey(target.name, k);
    const next = field.filter((p) => prefixKey(p.name, k) === key);
    letters.push(chars[k - 1]);
    counts.push(next.length);
    field = next;
  }

  // Too many share even the longest prefix we lock (a very common name):
  // the reel still turns through a readable handful, winner included.
  const others = shuffleSeeded(
    field.filter((p) => p.id !== targetId),
    targetId,
  ).slice(0, maxFinalists - 1);
  const finalists = shuffleSeeded([...others, target], `${targetId}:order`);
  return {
    letters,
    counts,
    finalists,
    winner: finalists.findIndex((p) => p.id === targetId),
  };
}
