import type { Quality } from "@/lib/hooks/use-frame-budget";

/**
 * The contract every draw style implements.
 *
 * A style reveals the winner the engine already committed; it never chooses
 * one. All of them obey the same three rules the name wall established:
 *
 * - The run is keyed on `targetId` alone. Everything else (duration, quality,
 *   reduced motion, the tick callback) is read through a ref when the run
 *   starts, so a frame-budget downgrade or a settings patch cannot restart a
 *   reveal halfway through.
 * - The final beat waits for `landed`, which the stage sets only once the
 *   engine has moved to `revealing`. A style may build up to the answer on its
 *   own clock, but it never finishes before the engine does.
 * - Nothing marks a name as the winner before `landed`. A style may show the
 *   winner among other names on the way (the wall lists everyone, a reel
 *   passes them), but no highlight, overlay or settled board singles them out
 *   until the engine reveals. Each style renders the winner under
 *   `data-testid="reveal-winner"` from that moment on, and only then — the
 *   e2e suite checks exactly that for every style.
 */
export interface RevealEntry {
  id: string;
  name: string;
}

export interface RevealProps {
  /** Everyone in the draw — the eligible roster, plus the target while it runs. */
  pool: RevealEntry[];
  /** The committed winner being revealed, or null when idle. */
  targetId: string | null;
  /** True once the engine has revealed the target. */
  landed: boolean;
  /**
   * The whole batch when the engine reveals several winners in one spin
   * (only the name wall asks for that), and the ones revealed so far.
   */
  targetIds?: string[];
  revealedIds?: string[];
  /** How long the engine will spin for this winner, suspense included. */
  durationMs: number;
  reducedMotion: boolean;
  quality: Quality;
  /** For the tick sound; fired on each visible step of the reveal. */
  onTick?: () => void;
  /**
   * For styles that keep revealing after `landed` (see `HOLDS_FINALE` in
   * `./meta.ts`): called once the whole name is on screen. The stage holds the
   * celebration and the winners rail for it, so the fanfare lands on the last
   * letter rather than the first. Such a style must always call it, reduced
   * motion included, or the winner is never celebrated.
   */
  onFinale?: (targetId: string) => void;
}

/**
 * Share of the spin a style may use to build up before holding for `landed`.
 * The remainder is the held beat — the moment the room is actually watching.
 */
export const RUN_SHARE = 0.86;
