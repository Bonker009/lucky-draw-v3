import type { PrizeRevealStyle } from "@/lib/domain/types";

/** Names and one-line pitches for the prize-reveal picker in setup. */
export const PRIZE_REVEAL_META: Record<PrizeRevealStyle, { label: string; hint: string }> = {
  cover: {
    label: "Cover lift",
    hint: "A covered card, then the cover lifts with one sweep of light and the name rises in.",
  },
  lineup: {
    label: "The running order",
    hint: "Every prize of the night in a row; the next one lifts out of it. Shows how far the evening has come.",
  },
  board: {
    label: "Departures board",
    hint: "The prize name flips in on split-flap tiles and the photo opens behind slats. Pairs with the split-flap draw.",
  },
  shutter: {
    label: "Louvre shutter",
    hint: "The photo fills the screen behind slats that turn open left to right. The most cinematic.",
  },
  focus: {
    label: "Focus pull",
    hint: "The photo starts blurred and grey in a viewfinder, then racks into focus. The room guesses as it sharpens.",
  },
};
