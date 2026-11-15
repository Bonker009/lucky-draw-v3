"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { splitRows } from "@/lib/stage/fit-text";
import { FLAP_LAND_MS, FLAP_SLOW_MS, revealTimes } from "@/lib/stage/flap-plan";
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
 *   right, while every tile still to come keeps shuffling. The name types
 *   itself out — but only after the engine has revealed it, and slowly enough
 *   to read each letter arrive (an earlier 110ms pace read as the whole name
 *   at once).
 *
 * How it types matters as much as that it does. The first cut stopped the
 * first tile after a beat and then snapped the rest in, and the fanfare and
 * confetti went off on that first letter — the room cheered a "S" and the
 * rest of the name arrived as an afterthought. So:
 *
 * - Each tile's slow-down is longer than a letter step, so the next tile is
 *   already slowing while this one lands: the motion rolls along the name.
 * - Slow flips and the landing are real flaps — the top half falls, the new
 *   letter's bottom half swings down — not a text swap. The landing flap is
 *   heavier and overshoots a touch.
 * - A word break gets its own beat: first name, pause, family name.
 * - The celebration waits for the last letter (`onFinale`), and the finished
 *   name glints once, in reading order, on the same beat.
 *
 * Everything is written straight into the tile nodes from one rAF loop, never
 * through React state, so the board cannot be disturbed by anything else on
 * the page. A flap's angle is a pure function of time since landing, so a
 * dropped frame skips ahead rather than drifting.
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
/** A churning tile changes letter this often, roughly a real flap's cadence. */
const FLIP_MS = 70;
/**
 * Flips in a tile's slow-down, as shares of `FLAP_SLOW_MS` into it. Each gap
 * is longer than the last, and the landing (at 1) has the longest of all.
 */
const SLOW_FLIPS = [0.14, 0.31, 0.52];
/** A slow-down flip's flap. Shorter than the smallest gap between them. */
const SLOW_FLAP_MS = 110;

interface TileNodes {
  root: HTMLSpanElement | null;
  top: HTMLSpanElement | null;
  bottom: HTMLSpanElement | null;
  flapTop: HTMLSpanElement | null;
  flapBottom: HTMLSpanElement | null;
}

/** What a frame wants a tile to show. Omitted fields are left as they are. */
interface TileFrame {
  top?: string;
  bottom?: string;
  flapTop?: string;
  flapBottom?: string;
  /** A flap's transform; empty means the flap is hidden. */
  topT?: string;
  bottomT?: string;
  state?: string;
}

/**
 * What was last written into each node, keyed on the node itself so a frame
 * only touches what changed. Keyed on the element, not the tile index: React
 * re-runs inline ref callbacks on every render, and an index-keyed cache that
 * was reset there believed the tiles were blank while the DOM still held
 * letters — blank tiles kept half a flap on screen after the name landed.
 */
const written = new WeakMap<HTMLElement, Record<string, string>>();
function put(el: HTMLElement | null, key: string, v: string, apply: (el: HTMLElement) => void) {
  if (!el) return;
  let w = written.get(el);
  if (!w) written.set(el, (w = {}));
  if (w[key] === v) return;
  w[key] = v;
  apply(el);
}

interface Run {
  targetId: string;
  chars: string[];
  /** ms after landing at which each tile's letter lands (its flap starts falling). */
  settleAt: number[];
  /** ms after landing at which the last flap is down and the name is complete. */
  doneAt: number;
  t0: number;
  landedAt: number | null;
  /** Flaps fallen so far, across all tiles — one tick each. */
  flips: number;
  finaled: boolean;
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

/** The churn letter tile `i` shows at flip `step`. */
function glyph(i: number, step: number) {
  // Per-tile offsets that share no factor with 26, so neighbouring tiles
  // never churn in lockstep.
  return CHARSET[(step * (5 + (i % 3) * 2) + i * 11 + i * i) % CHARSET.length];
}

const easeIn = (x: number) => x * x;
const easeOut = (x: number) => 1 - (1 - x) * (1 - x);
/** Swings a touch past flat and back, like a flap hitting its stop. */
const easeOutBack = (x: number) => {
  const c = 1.9;
  return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
};

export function FlapBoard({
  pool,
  targetId,
  landed,
  durationMs,
  reducedMotion,
  quality,
  onTick,
  onFinale,
}: RevealProps) {
  const live = useRef({ pool, durationMs, reducedMotion, quality, onTick, onFinale });
  useLayoutEffect(() => {
    live.current = { pool, durationMs, reducedMotion, quality, onTick, onFinale };
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

  const tileRefs = useRef<TileNodes[]>([]);
  const runRef = useRef<Run | null>(null);
  const rafRef = useRef<number | null>(null);
  // The one piece of React state the run touches: the name is complete. Set
  // once per winner, from the frame that finishes it.
  const [completeFor, setCompleteFor] = useState<string | null>(null);

  const nodes = (i: number) =>
    (tileRefs.current[i] ??= {
      root: null,
      top: null,
      bottom: null,
      flapTop: null,
      flapBottom: null,
    });

  const write = (i: number, f: TileFrame) => {
    const n = tileRefs.current[i];
    if (!n) return;
    const text = (el: HTMLElement | null, v: string | undefined) =>
      v !== undefined && put(el, "text", v, (e) => (e.textContent = v));
    // A flap with no transform is hidden, not merely flat, so an idle flap can
    // never cover the letter under it.
    const turn = (el: HTMLElement | null, v: string | undefined) =>
      v !== undefined &&
      put(el, "t", v, (e) => {
        e.style.visibility = v ? "visible" : "hidden";
        e.style.transform = v;
      });
    text(n.top, f.top);
    text(n.bottom, f.bottom);
    text(n.flapTop, f.flapTop);
    text(n.flapBottom, f.flapBottom);
    turn(n.flapTop, f.topT);
    turn(n.flapBottom, f.bottomT);
    if (f.state !== undefined) {
      const v = f.state;
      put(n.root, "state", v, (e) => (e.dataset.state = v));
    }
  };

  /** A still tile showing one letter (or nothing). */
  const still = (i: number, ch: string, state: string) =>
    write(i, { top: ch, bottom: ch, topT: "", bottomT: "", state });

  /**
   * A flap `p` of the way from `prev` to `next`: the new letter's top is
   * already showing behind the falling half of the old one; past halfway the
   * new letter's bottom half swings down over the old bottom.
   */
  const flap = (
    i: number,
    prev: string,
    next: string,
    p: number,
    landing: boolean,
    state: string,
  ) => {
    if (p >= 1) return still(i, next, state);
    if (p < 0.5) {
      const a = -90 * easeIn(p / 0.5);
      write(i, {
        top: next,
        bottom: prev,
        flapTop: prev,
        topT: `perspective(40vw) rotateX(${a.toFixed(1)}deg)`,
        bottomT: "",
        state,
      });
    } else {
      const q = (p - 0.5) / 0.5;
      const a = 90 * (1 - (landing ? easeOutBack(q) : easeOut(q)));
      write(i, {
        top: next,
        bottom: prev,
        flapBottom: next,
        topT: "",
        bottomT: `perspective(40vw) rotateX(${a.toFixed(1)}deg)`,
        state,
      });
    }
  };

  const paint = (now: number): boolean => {
    const run = runRef.current;
    const tiles = tileRefs.current;
    if (!run) {
      for (let i = 0; i < tiles.length; i++) still(i, "", "idle");
      return false;
    }
    const elapsed = now - run.t0;
    const frame = Math.floor(elapsed / FLIP_MS);
    const { reducedMotion: rm, quality: q } = live.current;
    const churn = !rm && q !== "minimal";
    const sinceLanded = run.landedAt === null ? -1 : now - run.landedAt;
    const landedRel = run.landedAt === null ? 0 : run.landedAt - run.t0;

    let flips = 0;
    for (let i = 0; i < tiles.length; i++) {
      const ch = (run.chars[i] ?? " ").trim();
      const settleAt = run.settleAt[i] ?? 0;
      const final = ch ? "set" : "blank";

      if (!churn) {
        // Reduced motion still types letter by letter — it only drops the
        // churn and the flaps.
        const isSet = sinceLanded >= 0 && sinceLanded >= settleAt;
        if (isSet) flips++;
        still(i, isSet ? ch : "", isSet ? final : "idle");
        continue;
      }

      const slowFrom = settleAt - FLAP_SLOW_MS;
      if (sinceLanded < 0 || sinceLanded < slowFrom) {
        // Blank tiles churn too: a still tile would mark where the winner's
        // name is not.
        still(i, glyph(i, frame), "flip");
        continue;
      }

      // Slowing down: the letter stops following the fast churn and steps
      // through a few heavy flaps at widening gaps, then lands. Counted from
      // the start of the slow-down, so it only ever moves forward.
      const into = sinceLanded - slowFrom;
      const base = Math.floor((landedRel + slowFrom) / FLIP_MS);
      const at = [...SLOW_FLIPS.map((s) => s * FLAP_SLOW_MS), FLAP_SLOW_MS];
      let j = 0;
      while (j < at.length && at[j] <= into) j++;
      flips += j;
      if (j === 0) {
        still(i, glyph(i, base), "slow");
        continue;
      }
      const landing = j === at.length;
      const prev = glyph(i, base + j - 1);
      const next = landing ? ch : glyph(i, base + j);
      const p = (into - at[j - 1]) / (landing ? FLAP_LAND_MS : SLOW_FLAP_MS);
      // Gold only once the flap is down: the old letter never falls in gold.
      flap(i, prev, next, p, landing, landing && p >= 1 ? final : "slow");
    }

    if (flips > run.flips) {
      run.flips = flips;
      live.current.onTick?.();
    }

    const doneAt = churn ? run.doneAt : Math.max(0, ...run.settleAt);
    const done = sinceLanded >= 0 && sinceLanded >= doneAt;
    if (done && !run.finaled) {
      run.finaled = true;
      setCompleteFor(run.targetId);
      live.current.onFinale?.(run.targetId);
    }
    return !done;
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
      ...revealTimes(chars),
      t0: performance.now(),
      landedAt: null,
      flips: 0,
      finaled: false,
    };
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the target only
  }, [targetId]);

  useEffect(() => {
    const run = runRef.current;
    if (landed && run && run.landedAt === null) {
      run.landedAt = performance.now();
      // A non-Latin name lands whole, in its own panel: nothing left to type,
      // so the celebration goes now. The tiles behind it still settle.
      if (!latinWinner) {
        run.finaled = true;
        setCompleteFor(run.targetId);
        live.current.onFinale?.(run.targetId);
      }
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

  const won = Boolean(targetId && landed);
  // The header and rule turn gold with the fanfare, on the last letter.
  const complete = won && completeFor === targetId;
  const status = !targetId ? "Ready" : complete ? "Winner" : landed ? "Arriving" : "Flipping";

  // Every half of a tile is the full tile, clipped — so a glyph's two halves
  // always line up — with the tile's own face behind it, so a falling flap
  // covers whatever is under it.
  const face =
    "absolute inset-0 flex items-center justify-center bg-gradient-to-b from-[#1b1c21] to-[#121317] [backface-visibility:hidden]";
  const topHalf = `${face} [clip-path:inset(0_0_50%_0)]`;
  const bottomHalf = `${face} [clip-path:inset(50%_0_0_0)]`;

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
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[min(1.5vh,1rem)] font-medium uppercase tracking-[0.08em] transition-colors duration-500 ${
              complete
                ? "border-gold/40 text-gold-bright"
                : "border-ink-100/15 text-ink-300"
            }`}
          >
            <span
              aria-hidden
              className={`size-1.5 rounded-full ${
                complete ? "bg-gold-bright" : landed && targetId ? "pulse-soft bg-ink-100" : "bg-ink-300"
              }`}
            />
            {status}
          </span>
        </div>

        <div className="relative">
          <div
            aria-hidden
            data-landed={won}
            className={`flap-board grid w-full gap-[0.35vw] transition-opacity duration-500 ${
              won && !latinWinner ? "opacity-15" : ""
            } ${complete && latinWinner && !reducedMotion ? "flap-done" : ""}`}
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: tileCount }, (_, i) => (
              <span
                key={i}
                ref={(el) => {
                  nodes(i).root = el;
                }}
                data-state="idle"
                style={{ "--i": i } as CSSProperties}
                className="@container relative aspect-[0.68] overflow-hidden rounded-[0.5vw] font-mono leading-none font-semibold text-ink-100 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05),0_0.6vh_1.6vh_rgb(0_0_0/0.45)] transition-[opacity,filter] duration-75 data-[state=flip]:opacity-70 data-[state=flip]:blur-[0.5px] data-[state=slow]:opacity-95 data-[state=set]:text-gold-bright data-[state=set]:[text-shadow:0_0_2.4vw_rgb(242_214_138/0.4)]"
              >
                <span
                  ref={(el) => {
                    nodes(i).top = el;
                  }}
                  className={`${topHalf} text-[78cqw]`}
                />
                <span
                  ref={(el) => {
                    nodes(i).bottom = el;
                  }}
                  className={`${bottomHalf} text-[78cqw]`}
                />
                {/* The flaps: the old letter's top falling, then the new
                    letter's bottom swinging down. Hidden between flips. */}
                <span
                  ref={(el) => {
                    nodes(i).flapTop = el;
                  }}
                  style={{ visibility: "hidden" }}
                  className={`${topHalf} z-[1] text-[78cqw] brightness-110`}
                />
                <span
                  ref={(el) => {
                    nodes(i).flapBottom = el;
                  }}
                  style={{ visibility: "hidden" }}
                  className={`${bottomHalf} z-[1] text-[78cqw] brightness-75`}
                />
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-1/2 z-[2] h-[2px] -translate-y-1/2 bg-base-900"
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
          className={`h-[2px] rounded-full transition-colors duration-700 ${
            complete
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
