"use client";

import { useEffect, useMemo, useRef } from "react";
import { participantName } from "@/lib/domain/selectors";
import type { DrawState } from "@/lib/domain/types";

export const ROSTER_ALL = "all";

/** Reading pace, in CSS pixels per second. Slow enough to scan by. */
const SCROLL_SPEED = 42;
/** Hold at each end so the first and last names are readable, not glimpsed. */
const EDGE_PAUSE_MS = 2600;

/**
 * Column count and type size.
 *
 * Four columns is the house layout. The only exceptions are very short
 * lists, where spreading three names across four columns leaves a mostly
 * empty board and reads as a mistake.
 *
 * The list scrolls, so the names never shrink to make a long list fit: the
 * size is chosen purely for legibility from the back of the room.
 */
function layoutFor(count: number) {
  if (count <= 4) return { columns: 1, size: "clamp(3rem, 9.5vh, 7rem)" };
  if (count <= 8) return { columns: 2, size: "clamp(2.25rem, 6.5vh, 4.5rem)" };
  return { columns: 4, size: "clamp(1.5rem, 4vh, 2.6rem)" };
}

/**
 * The photo-call board: every winner of a prize on screen at once.
 *
 * Events shoot a group photo per prize, and a scrolling sidebar does not work
 * for that — the whole group has to see the list, find themselves and come up.
 * Numbered, so the host can call "one through eight" and the group can check
 * itself before the shutter.
 *
 * Long lists scroll themselves, gently, up and back down forever. The
 * alternative is shrinking the type until nobody past the third row can read
 * it, which defeats the point of putting the list up at all.
 */
export function PhotoCall({
  state,
  scope,
  prizeImageUrl,
  reducedMotion = false,
}: {
  state: DrawState;
  /** A prize id, or ROSTER_ALL. */
  scope: string;
  prizeImageUrl: string | null;
  reducedMotion?: boolean;
}) {
  const isAll = scope === ROSTER_ALL;
  const prize = isAll ? undefined : state.prizesById.get(scope);
  const scrollRef = useRef<HTMLOListElement>(null);

  const winners = useMemo(() => {
    const rows = isAll
      ? state.winners
      : state.winners.filter((w) => w.prizeId === scope);
    return rows.map((w) => ({
      key: `${w.prizeId}-${w.participantId}`,
      name: participantName(state, w.participantId),
    }));
  }, [isAll, scope, state]);

  const layout = layoutFor(winners.length);

  // Continuous scroll, driven by rAF so the speed is the same whatever the
  // list length, and paused at both ends.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || reducedMotion) return;

    let raf = 0;
    let last = performance.now();
    let direction: 1 | -1 = 1;
    let pausedUntil = performance.now() + EDGE_PAUSE_MS;
    let position = 0;

    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;

      const overflow = el.scrollHeight - el.clientHeight;
      if (overflow <= 1) {
        // Nothing to scroll: a short list just sits there.
        raf = requestAnimationFrame(step);
        return;
      }

      if (now >= pausedUntil) {
        position += direction * SCROLL_SPEED * dt;

        if (position >= overflow) {
          position = overflow;
          direction = -1;
          pausedUntil = now + EDGE_PAUSE_MS;
        } else if (position <= 0) {
          position = 0;
          direction = 1;
          pausedUntil = now + EDGE_PAUSE_MS;
        }

        el.scrollTop = position;
      }

      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // Restart when the list or its shape changes, so a winner added while the
    // board is up is picked up by the scroll bounds.
  }, [reducedMotion, winners.length, layout.columns]);

  return (
    <section
      className="flex h-full w-full flex-col items-center gap-[2vh] px-[3vw] py-[2.5vh]"
      aria-labelledby="photo-call-heading"
    >
      <header className="flex shrink-0 flex-col items-center gap-2 text-center">
        {prizeImageUrl && !isAll ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob: URL from IndexedDB, downscaled on upload
          <img
            src={prizeImageUrl}
            alt=""
            className="size-[8vh] rounded-2xl object-cover ring-1 ring-gold/40"
          />
        ) : null}
        <p className="stage-label text-gold">Photo session</p>
        <h1
          id="photo-call-heading"
          className="text-[clamp(1.5rem,3.6vh,2.75rem)] font-semibold leading-tight text-ink-100"
        >
          {isAll ? "All winners" : (prize?.name ?? "Winners")}
        </h1>
        <p className="text-[clamp(0.85rem,1.6vh,1.1rem)] text-ink-300">
          {winners.length} {winners.length === 1 ? "winner" : "winners"}
        </p>
      </header>

      {winners.length === 0 ? (
        <p className="text-ink-500">No winners drawn for this prize yet.</p>
      ) : (
        <ol
          ref={scrollRef}
          // reel-mask fades the top and bottom edges, so names enter and leave
          // the scroll instead of being sliced off by a hard boundary.
          className="reel-mask grid min-h-0 w-full flex-1 content-start gap-x-[2vw] gap-y-[0.5vh] overflow-y-hidden"
          style={{
            gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
          }}
        >
          {winners.map((winner, i) => (
            <li
              key={winner.key}
              className="flex min-w-0 items-baseline gap-[1vw]"
            >
              <span
                className="shrink-0 text-right tabular-nums text-gold/60"
                style={{
                  fontSize: `calc(${layout.size} * 0.45)`,
                  width: "2.6em",
                }}
              >
                {i + 1}
              </span>
              <span
                className="min-w-0 flex-1 truncate font-semibold text-ink-100"
                style={{ fontSize: layout.size }}
              >
                {winner.name}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
