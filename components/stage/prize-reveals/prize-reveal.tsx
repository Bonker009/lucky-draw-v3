"use client";

import type { PrizeRevealStyle } from "@/lib/domain/types";
import { BoardReveal } from "./board";
import { CoverReveal } from "./cover";
import { FocusReveal } from "./focus";
import { LineupReveal } from "./lineup";
import { ShutterReveal } from "./shutter";
import type { PrizeRevealProps } from "./types";

/**
 * The stage's prize-announcement slot. Every style takes the same props
 * (`./types.ts`), so switching style in setup is a rendering choice only.
 * Keyed on the prize by the caller, so a new prize always starts covered.
 */
export function PrizeReveal({ style, ...props }: PrizeRevealProps & { style: PrizeRevealStyle }) {
  return (
    <section
      aria-label={`Prize reveal: ${props.revealed ? props.name : `prize ${props.position} of ${props.total}`}`}
      data-revealed={props.revealed}
      className="relative h-full w-full"
    >
      {style === "lineup" ? (
        <LineupReveal {...props} />
      ) : style === "board" ? (
        <BoardReveal {...props} />
      ) : style === "shutter" ? (
        <ShutterReveal {...props} />
      ) : style === "focus" ? (
        <FocusReveal {...props} />
      ) : (
        <CoverReveal {...props} />
      )}
    </section>
  );
}
