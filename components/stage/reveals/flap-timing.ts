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
 * Each tile slows its churn over this long before it lands — a few heavy
 * flips, then the letter — so every letter gets the "about to land" beat the
 * first one had, not just the first.
 */
export const FLAP_SLOW_MS = 480;
/** Long names type faster, so the whole name never takes longer than this. */
export const FLAP_TYPING_MS = 6000;
