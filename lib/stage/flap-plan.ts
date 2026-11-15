/**
 * How the split-flap board types a name out after the reveal. Shared with the
 * stage controller, which adds the typing time to the engine's hold so the
 * next draw of a batch never starts mid-name.
 */

/**
 * Gap between letters landing. At 350ms the first letter (which had the whole
 * spin as build-up) felt fine and every letter after it felt rushed.
 */
export const FLAP_LETTER_MS = 560;
/**
 * Extra beat between words — first name, pause, family name — the way a host
 * would say it. Without it a two-word name ran together as one string.
 */
export const FLAP_WORD_GAP_MS = 650;
/**
 * Each tile slows its churn over this long before it lands — a few heavy
 * flips at widening gaps, then the letter. It is longer than a letter step on
 * purpose: the next tile is already slowing while this one lands, so the
 * motion rolls along the name instead of one tile stopping and the rest
 * snapping in after it (the first letter used to be the only one with a
 * proper build-up).
 */
export const FLAP_SLOW_MS = 900;
/** The landing flip itself: the last flap falling onto the letter. */
export const FLAP_LAND_MS = 260;
/**
 * Long names type faster, so the whole name — slow-down, letters, word gaps
 * and the last landing flip — never takes longer than this.
 */
export const FLAP_TYPING_MS = 8000;

/** When a word gap would shrink below this many letter steps, gaps scale down with the steps instead. */
const MIN_GAP_PER_STEP = 1.4;

/**
 * When each tile lands after the reveal, in reading order (row by row, left
 * to right), in ms after the reveal. Letters take a step each, plus a beat
 * where a new word starts (a row break counts). A blank lands with the letter
 * after it, so it never goes still ahead of the sequence and marks where the
 * name is; blanks after the last letter land with it, so the board finishes
 * on the name.
 *
 * The first letter lands one slow-down after the reveal, like every other.
 * `doneAt` — the last flap down — never passes `FLAP_TYPING_MS`, which the
 * engine's hold is padded by.
 */
export function revealTimes(chars: string[]): { settleAt: number[]; doneAt: number } {
  const letters: number[] = [];
  const wordStart: boolean[] = [];
  let sawLetter = false;
  let inGap = false;
  chars.forEach((c, i) => {
    if (c.trim()) {
      letters.push(i);
      wordStart.push(sawLetter && inGap);
      sawLetter = true;
      inGap = false;
    } else if (sawLetter) {
      inGap = true;
    }
  });

  const steps = Math.max(1, letters.length - 1);
  const breaks = wordStart.filter(Boolean).length;
  const budget = FLAP_TYPING_MS - FLAP_SLOW_MS - FLAP_LAND_MS;
  let gap = FLAP_WORD_GAP_MS;
  let step = Math.min(FLAP_LETTER_MS, (budget - breaks * gap) / steps);
  // A very long name: fixed gaps would squeeze the letters, so they scale
  // down together and a gap stays a little longer than a step.
  if (step * MIN_GAP_PER_STEP < gap) {
    step = Math.min(FLAP_LETTER_MS, budget / (steps + breaks * MIN_GAP_PER_STEP));
    gap = step * MIN_GAP_PER_STEP;
  }

  const letterAt: number[] = [];
  let t = FLAP_SLOW_MS;
  letters.forEach((_, k) => {
    if (k > 0) t += step + (wordStart[k] ? gap : 0);
    letterAt.push(t);
  });

  const last = letterAt.length ? letterAt[letterAt.length - 1] : FLAP_SLOW_MS;
  let next = 0;
  const settleAt = chars.map((_, i) => {
    while (next < letters.length && letters[next] < i) next++;
    return next < letters.length ? letterAt[next] : last;
  });
  return { settleAt, doneAt: last + FLAP_LAND_MS };
}
