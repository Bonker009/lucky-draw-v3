/**
 * Fit a name to a box by size, never by cutting it.
 *
 * A winner's name is the one string on the stage that must never be
 * truncated — "Bunthoeun Chanthav…" on the projector is a name the room cannot
 * read and the winner cannot be sure is theirs. So instead of an ellipsis,
 * every reveal asks for the largest size at which the whole name wraps into
 * the lines it has.
 *
 * `measure` is injected so this stays pure and runs under the Node test
 * runner (no canvas there); the stage passes a canvas-backed measurer.
 */

/** Width in px of `text` set at `px`. */
export type Measure = (text: string, px: number) => number;

export interface FitOptions {
  maxWidth: number;
  maxLines: number;
  max: number;
  min: number;
  step?: number;
  measure: Measure;
}

/** How many lines `text` wraps into at `px`, or Infinity if a word cannot fit. */
export function lineCount(text: string, px: number, maxWidth: number, measure: Measure): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const space = measure(" ", px);
  let lines = 1;
  let width = 0;
  for (const word of words) {
    const w = measure(word, px);
    if (w > maxWidth) return Infinity;
    if (width === 0) width = w;
    else if (width + space + w <= maxWidth) width += space + w;
    else {
      lines += 1;
      width = w;
    }
  }
  return lines;
}

/**
 * The largest size in [min, max] at which `text` fits `maxLines` lines.
 * Returns `min` when nothing fits — the caller pairs it with
 * `overflow-wrap: anywhere`, so an unbreakable word still stays inside.
 */
export function fitFontSize(text: string, opts: FitOptions): number {
  const { maxWidth, maxLines, max, min, step = 2, measure } = opts;
  if (maxWidth <= 0) return min;
  for (let px = Math.floor(max); px >= min; px -= step) {
    if (lineCount(text, px, maxWidth, measure) <= maxLines) return px;
  }
  return min;
}

/**
 * Split a name into at most two rows at the space nearest its middle, for
 * layouts with fixed cells (the split-flap board). Names without a space, or
 * short enough for one row, come back as one row.
 */
export function splitRows(text: string, maxPerRow: number): string[] {
  const t = text.trim();
  if (t.length <= maxPerRow || !t.includes(" ")) return [t];
  const mid = t.length / 2;
  let best = -1;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  }
  return [t.slice(0, best).trim(), t.slice(best + 1).trim()];
}

let ctx: CanvasRenderingContext2D | null = null;

/** A canvas-backed `Measure` for the browser. */
export function canvasMeasure(weight: number, family: string): Measure {
  return (text, px) => {
    if (!ctx) ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return text.length * px * 0.56;
    ctx.font = `${weight} ${px}px ${family}`;
    return ctx.measureText(text).width;
  };
}
