"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { splitRows } from "@/lib/stage/fit-text";
import { FLAP_LETTER_MS, FLAP_SLOW_MS, FLAP_TYPING_MS } from "./flap-timing";
import type { RevealProps } from "./types";

/*
 * Split-flap board: the winner's name lands on a departures board.
 *
 * Nothing about the winner shows before the engine reveals. An earlier
 * version settled letters left to right over the spin and sized the board to
 * the winner's name, so the room could read the length, see where the space
 * fell and guess the first name long before the end. Now:
 *
 * - The board's shape comes from the whole roster (its longest name), never
 *   from the winner, so the tile count says nothing about who it is.
 * - Every tile churns for the whole spin — blanks and spaces included — so no
 *   position, length or prefix leaks.
 * - At `landed` the tiles settle one at a time in reading order, left to
 *   right, while every tile still to come keeps shuffling; each letter turns
 *   gold as it lands, with a tick. The name types itself out — but only
 *   after the engine has revealed it, and slowly enough to read each letter
 *   arrive (an earlier 110ms pace read as the whole name at once).
 *
 * The churn is written straight into the tile nodes from one rAF loop, never
 * through React state, so the board cannot be disturbed by anything else on
 * the page.
 *
 * A split-flap only has Latin letters. A winner whose name is in another
 * script (Khmer, most often) still gets the same churning tiles during the
 * spin — switching to a different layout up front would itself give away the
 * script of the winner's name — and their name lands in one wide panel over
 * the board, so its clusters are never split into tiles.
 */

const LATIN = /^[\p{Script=Latin}\p{N}\s.'’-]+$/u;
const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MIN_TILES = 12;
const MAX_TILES = 22;
/**
 * Past this many characters a name splits onto two rows at a space. One long
 * row shrank every tile until a 30-character name was small text on a big
 * screen; two rows keep the tiles large.
 */
const MAX_PER_ROW = 16;
/** A flipping tile changes letter this often, roughly a real flap's cadence. */
const FLIP_MS = 70;
/** Flips in a tile's slow-down before it lands, ms into the slow-down: each gap longer than the last. */
const SLOW_FLIPS = [0, 60, 140, 250, 380];

interface Run {
  targetId: string;
  chars: string[];
  /** ms after landing at which each tile settles. */
  settleAt: number[];
  t0: number;
  landedAt: number | null;
  settled: number;
}

/** The board's shape, from the roster alone — never from the winner. */
function boardShape(names: string[]) {
  let longest = 0;
  let twoRows = false;
  for (const name of names) {
    const up = name.toLocaleUpperCase();
    if (!LATIN.test(up)) continue;
    const rows = splitRows(up, MAX_PER_ROW);
    if (rows.length > 1) twoRows = true;
    for (const r of rows) longest = Math.max(longest, Array.from(r).length);
  }
  const cols = Math.min(MAX_TILES, Math.max(MIN_TILES, longest));
  return { cols, rows: twoRows ? 2 : 1 };
}

/**
 * When each tile settles after landing, in reading order (row by row, left to
 * right). Letters take a step each; a blank settles with the letter after it,
 * so it never goes still ahead of the sequence and marks where the name is.
 */
function revealTimes(chars: string[]): number[] {
  const letters = chars.filter((c) => c.trim()).length;
  const step = Math.min(
    FLAP_LETTER_MS,
    (FLAP_TYPING_MS - FLAP_SLOW_MS) / Math.max(1, letters),
  );
  // Every tile — the first included — lands after its own slow-down, so the
  // sequence starts one slow-down after the reveal.
  let k = 0;
  return chars.map((c) => FLAP_SLOW_MS + step * (c.trim() ? k++ : k));
}

export function FlapBoard({
  pool,
  targetId,
  landed,
  durationMs,
  reducedMotion,
  quality,
  onTick,
}: RevealProps) {
  const live = useRef({ pool, durationMs, reducedMotion, quality, onTick });
  useLayoutEffect(() => {
    live.current = { pool, durationMs, reducedMotion, quality, onTick };
  });

  const shape = useMemo(
    () => boardShape(pool.map((p) => p.name)),
    // The roster's shape, not the winner's: recomputed when the roster changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pool.length],
  );
  const { cols } = shape;
  const tileCount = cols * shape.rows;

  const targetName = targetId
    ? (pool.find((p) => p.id === targetId)?.name ?? null)
    : null;
  const latinWinner = targetName === null || LATIN.test(targetName);

  const tileRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const runRef = useRef<Run | null>(null);
  const rafRef = useRef<number | null>(null);

  const paint = (now: number): boolean => {
    const run = runRef.current;
    const tiles = tileRefs.current;
    if (!run) {
      tiles.forEach((t) => {
        if (t) {
          t.textContent = "";
          t.dataset.state = "idle";
        }
      });
      return false;
    }
    const elapsed = now - run.t0;
    const frame = Math.floor(elapsed / FLIP_MS);
    const { reducedMotion: rm, quality: q } = live.current;
    const churn = !rm && q !== "minimal";
    const sinceLanded = run.landedAt === null ? -1 : now - run.landedAt;

    let settled = 0;
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      if (!tile) continue;
      const ch = (run.chars[i] ?? " ").trim();
      // Reduced motion still types letter by letter — it only drops the churn.
      const settleAt = run.settleAt[i];
      const isSet = sinceLanded >= 0 && sinceLanded >= settleAt;
      if (isSet) {
        settled++;
        if (tile.textContent !== ch) tile.textContent = ch;
        tile.dataset.state = ch ? "set" : "blank";
      } else if (churn) {
        // The tile about to land slows down: its letter stops following the
        // fast frame and steps through a few flips at widening gaps, then
        // the letter lands. Counted from the start of the slow-down, so it
        // only ever moves forward.
        const toGo = sinceLanded >= 0 ? settleAt - sinceLanded : Infinity;
        const slowing = toGo < FLAP_SLOW_MS;
        let step = frame;
        if (slowing) {
          const into = FLAP_SLOW_MS - toGo;
          const slowStart = elapsed - into;
          step =
            Math.floor(slowStart / FLIP_MS) +
            SLOW_FLIPS.filter((at) => at <= into).length;
        }
        // Per-tile offsets that share no factor with 26, so neighbouring
        // tiles never churn in lockstep. Blank tiles churn too: a still tile
        // would mark where the winner's name is not.
        tile.textContent =
          CHARSET[(step * (5 + (i % 3) * 2) + i * 11 + i * i) % CHARSET.length];
        tile.dataset.state = slowing ? "slow" : "flip";
      } else {
        tile.textContent = "";
        tile.dataset.state = "idle";
      }
    }
    if (settled > run.settled) {
      run.settled = settled;
      live.current.onTick?.();
    }
    return settled < tiles.length;
  };

  const kick = () => {
    if (rafRef.current !== null) return;
    const loop = (now: number) => {
      rafRef.current = null;
      if (paint(now)) rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  };

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    },
    [],
  );

  // A new target starts a run. Keyed on the target alone.
  useEffect(() => {
    if (!targetId || targetName === null) {
      runRef.current = null;
      kick();
      return;
    }
    // Where the winner's letters will land. A one-row name sits on the first
    // row of a two-row board; nobody sees this until the cascade.
    const display = latinWinner ? targetName.toLocaleUpperCase() : "";
    const rows = display ? splitRows(display, cols) : [];
    const chars = Array.from({ length: shape.rows }, (_, r) => {
      const rc = Array.from(rows[r] ?? "");
      const pad = Math.floor((cols - rc.length) / 2);
      return Array.from({ length: cols }, (_, i) => rc[i - pad] ?? " ");
    }).flat();
    runRef.current = {
      targetId,
      chars,
      settleAt: revealTimes(chars),
      t0: performance.now(),
      landedAt: null,
      settled: 0,
    };
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the target only
  }, [targetId]);

  useEffect(() => {
    const run = runRef.current;
    if (landed && run && run.landedAt === null) {
      run.landedAt = performance.now();
      kick();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kick only schedules a frame
  }, [landed, targetId]);

  /*
   * Centre on the screen, not the column. The column stops where the winners
   * list starts, so its middle sits left of the screen's — the board looked
   * pushed aside. Shift by the difference, and cap the width so the board
   * never runs under the list.
   */
  const rootRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ shift: 0, room: 0 });
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const screenMid = window.innerWidth / 2;
      const shift = screenMid - (r.left + r.width / 2);
      // Widest board centred on screenMid that still fits inside the column.
      const room = 2 * Math.min(screenMid - r.left, r.right - screenMid);
      setFrame({ shift, room: Math.max(0, room) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const boardWidth = `min(${cols * (shape.rows > 1 ? 5.2 : 6.2)}vw, ${frame.room ? `${frame.room}px` : "100%"})`;

  const status = !targetId ? "Ready" : landed ? "Winner" : "Flipping";
  const won = Boolean(targetId && landed);

  return (
    // Centred as one block — header, tiles and rule share the board's width —
    // so the board sits in the middle of the stage rather than the header
    // hugging the column edge while the tiles float in the middle.
    <div ref={rootRef} className="flex h-full min-h-0 w-full items-center justify-center">
      <div
        className="flex w-full flex-col gap-[5vh]"
        style={{ maxWidth: boardWidth, transform: `translateX(${frame.shift}px)` }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[min(1.7vh,1.1rem)] font-medium uppercase tracking-[0.14em] text-ink-500">
            Now drawing
          </span>
          <span
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[min(1.5vh,1rem)] font-medium uppercase tracking-[0.08em] ${
              won
                ? "border-gold/40 text-gold-bright"
                : "border-ink-100/15 text-ink-300"
            }`}
          >
            <span
              aria-hidden
              className={`size-1.5 rounded-full ${won ? "bg-gold-bright" : "bg-ink-300"}`}
            />
            {status}
          </span>
        </div>

        <div className="relative">
          <div
            aria-hidden
            data-landed={won}
            className={`group grid w-full gap-[0.35vw] transition-opacity duration-500 ${
              won && !latinWinner ? "opacity-15" : ""
            }`}
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: tileCount }, (_, i) => (
              <span
                key={i}
                className="@container relative aspect-[0.68] overflow-hidden rounded-[0.5vw] bg-gradient-to-b from-[#1b1c21] to-[#121317] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05),0_0.6vh_1.6vh_rgb(0_0_0/0.45)]"
              >
                <span
                  ref={(el) => {
                    tileRefs.current[i] = el;
                  }}
                  data-state="idle"
                  className="absolute inset-0 flex items-center justify-center font-mono text-[78cqw] leading-none font-semibold text-ink-100 transition-[opacity,filter] duration-75 data-[state=flip]:opacity-70 data-[state=flip]:blur-[0.5px] data-[state=slow]:opacity-90 data-[state=set]:text-gold-bright data-[state=set]:[text-shadow:0_0_2.4vw_rgb(242_214_138/0.4)]"
                />
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 bg-base-900"
                />
              </span>
            ))}
          </div>

          {/* A name in a non-Latin script lands as one panel over the board. */}
          {won && !latinWinner && targetName ? (
            <div className="reveal-rise absolute inset-0 flex items-center justify-center">
              <span className="name-mixed max-w-full rounded-[1vw] bg-gradient-to-b from-[#1b1c21] to-[#121317] px-[3vw] py-[2vh] text-[min(9vh,6rem)] font-semibold text-gold-bright shadow-[inset_0_0_0_1px_rgb(242_214_138/0.4),0_2vh_6vh_rgb(0_0_0/0.6)] [overflow-wrap:anywhere]">
                {targetName}
              </span>
            </div>
          ) : null}
        </div>

        <div
          aria-hidden
          className={`h-[2px] rounded-full ${
            won
              ? "bg-gradient-to-r from-gold-bright/70 to-transparent"
              : "bg-gradient-to-r from-ink-100/15 to-transparent"
          }`}
        />

        {won && targetName ? (
          <span data-testid="reveal-winner" className="sr-only">
            {targetName}
          </span>
        ) : null}
      </div>
    </div>
  );
}
