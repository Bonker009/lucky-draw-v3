"use client";

import { useMemo } from "react";
import type { DrawState } from "@/lib/domain/types";

/**
 * The last winners, newest first.
 *
 * Capped at a fixed count: an event with 175 winners must not grow the DOM
 * over the course of the show.
 *
 * Scrolls inside itself and never pushes the page taller. The previous version
 * rendered a plain column into a `min-h-dvh` page, so once about nine names had
 * been drawn the rail ran off the bottom of the projector and took the stage
 * controls with it.
 */
export function WinnersRail({
  state,
  limit = 12,
  hideCount = 0,
}: {
  state: DrawState;
  limit?: number;
  /**
   * Winners that are committed but not yet revealed on the drum.
   *
   * The engine deliberately commits a winner *before* the reel starts
   * spinning towards them, so nothing can ever be announced that was not
   * saved. The cost is that `state.winners` knows the answer for the whole
   * five seconds the drum is turning — and this rail was printing that name
   * beside the reel while the audience watched it spin. Trimming the tail is
   * what keeps the projector showing only what has actually been revealed.
   */
  hideCount?: number;
}) {
  const total = Math.max(0, state.winners.length - hideCount);

  const recent = useMemo(
    () => state.winners.slice(0, total).slice(-limit).reverse(),
    [state.winners, total, limit],
  );

  if (recent.length === 0) return null;

  return (
    <aside className="flex h-full min-h-0 w-64 shrink-0 flex-col gap-3 border-l border-ink-500/15 py-6 pl-5 pr-4 xl:w-72">
      <h2 className="shrink-0 stage-label text-[0.6rem] text-ink-500">
        Winners · {total}
      </h2>

      {/* The fade tells the audience the list continues without a scrollbar
          appearing on a projected screen. */}
      <ol className="list-fade-bottom flex min-h-0 flex-1 flex-col gap-px overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {recent.map((winner, i) => (
          <li
            key={`${winner.prizeId}-${winner.participantId}`}
            // rail-enter plays once per mount. Keys are per-winner and stable,
            // so only the row that just appeared animates — the rest of the
            // list is untouched.
            className={`rail-enter shrink-0 truncate rounded-lg px-3 py-2 ${
              // The newest winner is the one the audience is still looking for
              // on the rail, so it keeps the accent.
              i === 0 ? "bg-gold/10 ring-1 ring-gold/25" : ""
            }`}
          >
            <span
              className={`block truncate text-[0.95rem] leading-tight ${
                i === 0 ? "text-gold-bright" : "text-ink-100"
              }`}
            >
              {state.participantsById.get(winner.participantId)?.name ??
                winner.participantId}
            </span>
            <span className="block truncate text-xs text-ink-500">
              {state.prizesById.get(winner.prizeId)?.name ?? ""}
            </span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
