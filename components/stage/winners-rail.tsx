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

  const width = "w-[19vw] min-w-60 max-w-96 shrink-0";

  // Hold the rail's width even before the first winner. Appearing on the
  // first reveal used to narrow the name wall at exactly the moment the room
  // was reading it, reflowing every column under the winner's name.
  if (recent.length === 0) return <div aria-hidden className={width} />;

  return (
    <aside className={`flex h-full min-h-0 ${width} flex-col gap-[2.5vh] border-l border-ink-100/[0.07] pb-[8vh] pl-[2vw] pr-[2.4vw] pt-[7vh]`}>
      <h2 className="shrink-0 text-[min(1.3vh,0.85rem)] font-medium uppercase tracking-[0.08em] text-ink-500">
        Winners · {total}
      </h2>

      {/* The fade tells the audience the list continues without a scrollbar
          appearing on a projected screen. */}
      <ol className="list-fade-bottom flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {recent.map((winner, i) => (
          <li
            key={`${winner.prizeId}-${winner.participantId}`}
            // rail-enter plays once per mount. Keys are per-winner and stable,
            // so only the row that just appeared animates — the rest of the
            // list is untouched.
            className="rail-enter shrink-0 border-b border-ink-100/[0.07] py-[1.5vh]"
          >
            <span
              // The newest winner is the one the audience is still looking for
              // on the rail, so it keeps the accent.
              // Two lines, not an ellipsis: a long winner's name cut to
              // "Leakhena Sopheaktra Vi…" is not one they can be sure is theirs.
              className={`name-mixed line-clamp-2 text-[min(2.2vh,1.5rem)] leading-snug tracking-tight [overflow-wrap:anywhere] ${
                i === 0
                  ? "font-semibold text-gold-bright"
                  : "font-medium text-ink-100"
              }`}
            >
              {state.participantsById.get(winner.participantId)?.name ??
                winner.participantId}
            </span>
            <span className="mt-0.5 block truncate text-[min(1.4vh,0.95rem)] text-ink-500">
              {state.prizesById.get(winner.prizeId)?.name ?? ""}
            </span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
