"use client";

import type { DrawStyle } from "@/lib/domain/types";
import { NameWall } from "@/components/stage/name-wall";
import { ClassicReel } from "./classic-reel";
import { Envelope } from "./envelope";
import { FlapBoard } from "./flap-board";
import { LetterReels } from "./letter-reels";
import type { RevealProps } from "./types";

/**
 * The stage's one reveal slot. Every style takes the same props and keeps the
 * same contract (see `./types.ts`), so switching style is a rendering choice
 * and nothing else — the engine, the commit order and the no-spoiler rules do
 * not know which one is on screen.
 */
export function DrawReveal({ style, ...props }: RevealProps & { style: DrawStyle }) {
  switch (style) {
    case "flap":
      return <FlapBoard {...props} />;
    case "envelope":
      return <Envelope {...props} />;
    case "letters":
      return <LetterReels {...props} />;
    case "reel":
      return <ClassicReel {...props} />;
    case "wall":
    default:
      return <NameWall {...props} />;
  }
}
