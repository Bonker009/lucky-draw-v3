"use client";

import type { ReactNode } from "react";

/**
 * Centres the drum on the stage and caps its width.
 *
 * This used to be a full cabinet — a lit sign with the prize above the drum
 * and a counter plinth below it. The stage now shows only the machine and the
 * winners rail, so the sign and plinth are gone; strips left in their place
 * read as stray lines, not as a frame.
 */
export function Cabinet({ drum }: { drum: ReactNode }) {
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col items-center justify-center">
      {drum}
    </div>
  );
}
