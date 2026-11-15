import type { DrawStyle } from "@/lib/domain/types";

/**
 * Styles whose reveal keeps going after the engine reveals — the split-flap
 * board types the name out — and which call `onFinale` when it is complete.
 * The stage holds the fanfare, confetti and winners rail until then.
 */
export const HOLDS_FINALE: ReadonlySet<DrawStyle> = new Set<DrawStyle>(["flap"]);

/** Names and one-line pitches for the draw-style picker. */
export const DRAW_STYLE_META: Record<DrawStyle, { label: string; hint: string }> = {
  wall: {
    label: "Name wall",
    hint: "Everyone on screen, knocked out in halves until the winners are left — several winners are then called forward one by one. Best for big rooms.",
  },
  flap: {
    label: "Split-flap board",
    hint: "The name flips into place letter by letter, like a departures board.",
  },
  envelope: {
    label: "The envelope",
    hint: "A fan of name cards, one drawn face down, then turned over. Ceremonial.",
  },
  letters: {
    label: "Narrowing reels",
    hint: "Letter reels narrow the field, then a slow name reel stops on the winner.",
  },
  reel: {
    label: "Classic reel",
    hint: "The original spinning drum. Fast and familiar, but too quick to read at a big event.",
  },
};
