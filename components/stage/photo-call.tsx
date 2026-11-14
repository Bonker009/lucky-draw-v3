"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
 * The list shares the screen with the prize panel, so three columns is the
 * most it takes — four in two-thirds of the width truncates ordinary names.
 * Very short lists stay in one column, where spreading three names across
 * several leaves a mostly empty board and reads as a mistake.
 *
 * The list scrolls, so the names never shrink to make a long list fit: the
 * size is chosen purely for legibility from the back of the room.
 */
function layoutFor(count: number) {
  if (count <= 4) return { columns: 1, size: "clamp(2.75rem, 8.5vh, 6rem)" };
  if (count <= 10) return { columns: 2, size: "clamp(2rem, 5.5vh, 4rem)" };
  return { columns: 3, size: "clamp(1.4rem, 3.8vh, 2.4rem)" };
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

  // Whether the list is taller than its box. A short list is centred and left
  // unmasked; the edge fade is only for names scrolling in and out, and on a
  // list that fits it just dimmed the first row for no reason.
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setOverflowing(el.scrollHeight - el.clientHeight > 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [winners.length, layout.columns]);

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
    // Prize on the left, winners on the right: the prize is what the photo is
    // of, and giving it its own column lets the image be big enough to see
    // instead of a thumbnail above a list.
    <section
      className="grid h-full w-full grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)] gap-[3vw] px-[3vw] py-[2.5vh]"
      aria-labelledby="photo-call-heading"
    >
      <header className="flex min-h-0 flex-col items-center justify-center gap-[1.5vh] border-r border-gold/15 pr-[3vw] text-center">
        <p className="stage-label text-gold">Photo session</p>
        {prizeImageUrl && !isAll ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob: URL from IndexedDB, downscaled on upload
          <img
            src={prizeImageUrl}
            alt=""
            className="aspect-square min-h-0 w-full max-w-[52vh] shrink rounded-3xl object-cover ring-1 ring-gold/40"
          />
        ) : null}
        <h1
          id="photo-call-heading"
          className="text-balance text-[clamp(1.75rem,4.5vh,3.5rem)] font-semibold leading-tight text-gold"
        >
          {isAll ? "All winners" : (prize?.name ?? "Winners")}
        </h1>
        <p className="text-[clamp(0.95rem,2vh,1.4rem)] text-ink-300">
          {winners.length} {winners.length === 1 ? "winner" : "winners"}
        </p>
      </header>

      {winners.length === 0 ? (
        <p className="self-center text-center text-ink-500">
          No winners drawn for this prize yet.
        </p>
      ) : (
        <ol
          ref={scrollRef}
          // reel-mask fades the top and bottom edges, so names enter and leave
          // the scroll instead of being sliced off by a hard boundary. Only a
          // list that fits is centred — centring an overflowing one would
          // push its first rows out of reach above the top.
          className={`grid h-full min-h-0 w-full gap-x-[2vw] gap-y-[0.5vh] overflow-y-hidden ${
            overflowing ? "reel-mask content-start" : "content-center"
          } ${layout.columns === 1 ? "justify-items-center" : ""}`}
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
