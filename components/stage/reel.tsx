"use client";

import { useEffect, useRef, useState } from "react";
import { Rng } from "@/lib/domain/rng";
import type { Quality } from "@/lib/hooks/use-frame-budget";

const VISIBLE_ROWS = 5;
const MIN_ROW_HEIGHT = 64;
const MAX_ROW_HEIGHT = 128;
/**
 * Share of the viewport height the drum is allowed to occupy.
 *
 * The drum is no longer alone: the marquee sign above it and the counter
 * plinth below it are part of the same cabinet, and at 0.46 the three
 * together overflowed the stage row and clipped the sign off the top.
 */
const DRUM_VIEWPORT_SHARE = 0.34;
/**
 * The shortest runway. With a small roster the shuffled names repeat until
 * the drum has at least this many rows to build speed over.
 */
const RUNWAY = 34;
/**
 * Row nodes actually in the DOM: the visible rows plus one above and one
 * below, so a row is never seen being recycled.
 */
const WINDOW_ROWS = VISIBLE_ROWS + 2;
const CENTER_ROW = Math.floor(VISIBLE_ROWS / 2);

/** How far past the payline the drum carries before rubber-banding back. */
const OVERSHOOT_PX = 26;

/**
 * Peak motion blur at full tilt. Dropped entirely below full quality.
 *
 * Kept low deliberately. At 11px the names became grey smudges and the drum
 * read as an empty box for the whole spin — the audience needs to see names
 * streaming past, not evidence that something is moving.
 */
const MAX_BLUR_PX = 5;

/** Marquee bulbs per strip. Fixed, like everything else in the drum. */
const BULBS = 16;

export interface ReelProps {
  /**
   * Everyone still eligible. Every one of them passes the payline on every
   * spin; only `WINDOW_ROWS` of them are in the DOM at any moment.
   */
  pool: string[];
  /** The already-decided winner. The reel reveals it; it never chooses it. */
  target: string | null;
  /**
   * True once the drum has stopped on the winner. Purely presentational — it
   * enlarges the payline row so the landing reads as the reveal itself.
   */
  landed?: boolean;
  durationMs: number;
  reducedMotion: boolean;
  /** From the frame budget. Blur is the first thing dropped when frames slip. */
  quality?: Quality;
  onLanded?: () => void;
  /**
   * Called each time a row crosses the payline, for the tick sound. Read
   * through a ref, so a new callback never restarts a spin.
   */
  onTick?: () => void;
}

/**
 * The slot reel.
 *
 * Three deliberate properties:
 *
 * 1. The strip is virtual. Each spin shuffles the whole eligible pool into a
 *    runway that ends on the winner, so everyone goes past the payline —
 *    however short the spin. v3 first used a fixed sample of 34 decoys, and
 *    at a 200-person event the same few names scrolled by every time while
 *    most people never appeared at all, which reads as a rigged draw. Only
 *    `WINDOW_ROWS` nodes exist; they ride along inside the animated track and
 *    are re-labelled each frame for wherever the drum has got to. v2 rendered
 *    up to 59 rows, each carrying `transition: all 0.6s`, a text-shadow and a
 *    drop-shadow, and rebuilt the whole strip on every 2-second poll.
 *
 * 2. The whole spin is one Web Animations API animation on one node. React
 *    does not re-render while the reel is moving, so nothing that happens
 *    elsewhere on the page can disturb it — and the winner arrives as a prop,
 *    so this component cannot influence who wins.
 *
 * 3. The drum curve is two static overlays, not per-row 3D. Modelling a real
 *    cylinder would mean recomputing a rotateX for every row every frame; the
 *    overlays read the same from ten metres away and cost nothing.
 */
export function Reel({
  pool,
  target,
  landed = false,
  durationMs,
  reducedMotion,
  quality = "full",
  onLanded,
  onTick,
}: ReelProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const paylineRef = useRef<HTMLDivElement>(null);
  const housingRef = useRef<HTMLDivElement>(null);
  const drumRef = useRef<HTMLDivElement>(null);
  const sweepRef = useRef<HTMLSpanElement>(null);
  const winnerRef = useRef<HTMLSpanElement>(null);
  const animationRef = useRef<Animation | null>(null);
  const landedRef = useRef(false);
  const onLandedRef = useRef(onLanded);

  useEffect(() => {
    onLandedRef.current = onLanded;
  }, [onLanded]);

  const onTickRef = useRef(onTick);
  useEffect(() => {
    onTickRef.current = onTick;
  }, [onTick]);

  /*
   * The drum has to fit the projector it lands on, which is as often a 720p
   * beamer as a 4K panel. A fixed row height overflowed the short one and the
   * bottom of the barrel was cut off by the viewport.
   *
   * Resizing re-renders, but only ever between spins: a projector does not
   * change resolution mid-draw, and the spin reads the height it started with.
   */
  const [rowHeight, setRowHeight] = useState(MAX_ROW_HEIGHT);

  useEffect(() => {
    const measure = () =>
      setRowHeight(
        Math.max(
          MIN_ROW_HEIGHT,
          Math.min(
            MAX_ROW_HEIGHT,
            Math.floor(
              (window.innerHeight * DRUM_VIEWPORT_SHARE) / VISIBLE_ROWS,
            ),
          ),
        ),
      );
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const nameRefs = useRef<(HTMLSpanElement | null)[]>([]);
  /** The strip for the spin in progress (or the idle one). Never React state. */
  const stripRef = useRef<Strip>({ names: [], landingIndex: -1 });
  const spinCount = useRef(0);
  const landedPropRef = useRef(landed);

  // The pool is read when a spin starts, never followed during one: the
  // winner is committed just before the drum starts, which changes the
  // eligible pool at exactly the moment a restart would be most visible.
  const poolRef = useRef(pool);
  useEffect(() => {
    poolRef.current = pool;
  }, [pool]);

  const duration = reducedMotion ? 400 : durationMs;

  /**
   * Label and style the window rows for a scroll position of `y` pixels.
   * Runs every frame during a spin, so it only touches what changed.
   */
  const paint = (y: number) => {
    const { names, landingIndex } = stripRef.current;
    const first = Math.max(0, Math.floor(y / rowHeight) - 1);
    const isLanded = landedPropRef.current;
    for (let i = 0; i < WINDOW_ROWS; i++) {
      const row = rowRefs.current[i];
      const label = nameRefs.current[i];
      if (!row || !label) continue;
      const index = first + i;
      const top = `translate3d(0, ${index * rowHeight}px, 0)`;
      if (row.style.transform !== top) row.style.transform = top;
      const text = names[index] ?? "";
      if (label.textContent !== text) label.textContent = text;

      const isWinner = index === landingIndex;
      const fontSize = `${Math.round(
        rowHeight * (isWinner ? (isLanded ? 0.58 : 0.5) : 0.42),
      )}px`;
      if (label.style.fontSize !== fontSize) label.style.fontSize = fontSize;
      if (
        label.dataset.winner === String(isWinner) &&
        label.dataset.landed === String(isLanded)
      ) {
        continue;
      }
      label.dataset.winner = String(isWinner);
      label.dataset.landed = String(isLanded);
      // classList, not className: the landing effects (`winner-pop`) are
      // added imperatively and must survive the restyle that follows.
      label.classList.toggle("font-bold", isWinner);
      label.classList.toggle("text-gold-bright", isWinner);
      label.classList.toggle(
        "[text-shadow:0_0_36px_rgb(242_214_138/0.55)]",
        isWinner && isLanded,
      );
      label.classList.toggle("font-medium", !isWinner);
      // Bright while the drum is spinning or idle, because then the strip is
      // the only thing on screen. Dimmed once the winner lands so the payline
      // owns the frame.
      label.classList.toggle("text-ink-300", !isWinner && !isLanded);
      label.classList.toggle("text-ink-500", !isWinner && isLanded);
    }
  };

  /*
   * Quality is read through a ref, never as an effect dependency.
   *
   * `useFrameBudget` downgrades the moment frames slip — which is precisely
   * when the confetti fires and the reel is blurring. As a dependency it
   * re-ran the spin effect mid-reveal, which cancelled the finished animation
   * and started a brand new spin, so the winner slid off the payline and the
   * drum began scrolling decoys again a second after landing.
   */
  const qualityRef = useRef(quality);
  useEffect(() => {
    qualityRef.current = quality;
  }, [quality]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const housing = housingRef.current;
    const drum = drumRef.current;

    /*
     * Re-adding a class in the same frame it was removed is coalesced by the
     * browser and the animation never plays. Reading a layout property in
     * between forces the restart.
     */
    const replay = (el: Element | null, className: string) => {
      if (!el || reducedMotion) return;
      el.classList.remove(className);
      void (el as HTMLElement).offsetWidth;
      el.classList.add(className);
    };

    animationRef.current?.cancel();
    animationRef.current = null;

    spinCount.current += 1;
    stripRef.current = buildStrip(
      poolRef.current,
      target,
      spinCount.current,
      // Reduced motion is for people who asked for less movement; streaming
      // the whole roster past them in 400ms would be the opposite.
      reducedMotion ? VISIBLE_ROWS * 2 : RUNWAY,
      reducedMotion,
    );
    const { landingIndex } = stripRef.current;
    // Land the winner on the payline, not at the top edge.
    const landingOffset = Math.max(0, landingIndex - CENTER_ROW) * rowHeight;

    // Follow the animation, re-labelling the window rows as the drum turns.
    // The transform itself stays on the compositor; this only reads it.
    // The same read drives the tick sound: one tick per row crossing the
    // payline, so the ticks slow with the brake and stop dead on the landing.
    let frame = 0;
    let lastRow = 0;
    const follow = () => {
      const m = new DOMMatrixReadOnly(getComputedStyle(track).transform);
      const y = -m.m42;
      paint(y);
      const row = Math.floor(y / rowHeight + 0.5);
      if (row !== lastRow) {
        lastRow = row;
        onTickRef.current?.();
      }
      frame = requestAnimationFrame(follow);
    };

    // Driven by `target` alone. Keying this on a "spinning" flag as well meant
    // the drum reset to the top the instant the engine moved to `revealing`,
    // which is exactly when the winner needs to stay under the payline.
    if (!target) {
      track.style.transform = "translate3d(0, 0, 0)";
      track.style.filter = "none";
      paint(0);
      housing?.classList.remove("reel-rumbling", "reel-impact");
      drum?.classList.remove("is-spinning", "is-win");
      return;
    }

    landedRef.current = false;

    const blur =
      reducedMotion || qualityRef.current !== "full" ? 0 : MAX_BLUR_PX;

    const land = () => {
      if (landedRef.current) return;
      landedRef.current = true;
      cancelAnimationFrame(frame);
      // Pin the final position and drop the filter, so the browser can retire
      // the composited layer instead of holding a blurred one all through the
      // reveal hold.
      track.style.transform = `translate3d(0, ${-landingOffset}px, 0)`;
      track.style.filter = "none";
      paint(landingOffset);
      winnerRef.current =
        nameRefs.current.find((el) => el?.dataset.winner === "true") ?? null;
      // The drum stops vibrating and takes the hit, the payline flares, a
      // band of light crosses it and the name pops. All of it is decoration
      // over an outcome that was decided before any of this started.
      housing?.classList.remove("reel-rumbling");
      drum?.classList.remove("is-spinning");
      if (!reducedMotion) drum?.classList.add("is-win");
      replay(housing, "reel-impact");
      replay(paylineRef.current, "payline-lock");
      replay(sweepRef.current, "payline-sweep");
      replay(winnerRef.current, "winner-pop");

      onLandedRef.current?.();
    };

    if (reducedMotion) {
      // No drum, no blur, no bounce — just move the winner onto the payline.
      const animation = track.animate(
        [
          { transform: "translate3d(0, 0, 0)" },
          { transform: `translate3d(0, ${-landingOffset}px, 0)` },
        ],
        { duration, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" },
      );
      animationRef.current = animation;
      animation.addEventListener("finish", land, { once: true });
      frame = requestAnimationFrame(follow);
      const fallback = setTimeout(land, duration + 400);
      return () => {
        clearTimeout(fallback);
        cancelAnimationFrame(frame);
        animation.cancel();
      };
    }

    /*
     * Four phases, each with its own easing:
     *   wind-up   — the drum takes off, blur ramps in
     *   run       — constant speed, fully blurred, the bulk of the spin
     *   brake     — decelerate and carry a little past the payline
     *   settle    — rubber-band back onto it
     *
     * v2 used a single cubic-bezier across the whole spin, which meant the
     * reel was already crawling two thirds of the way through and the landing
     * had no punch.
     */
    const animation = track.animate(
      [
        {
          offset: 0,
          transform: "translate3d(0, 0, 0)",
          filter: "blur(0px)",
          easing: "cubic-bezier(0.45, 0, 0.9, 0.4)",
        },
        {
          offset: 0.14,
          transform: `translate3d(0, ${-landingOffset * 0.09}px, 0)`,
          filter: `blur(${blur}px)`,
          easing: "linear",
        },
        {
          offset: 0.68,
          transform: `translate3d(0, ${-landingOffset * 0.74}px, 0)`,
          filter: `blur(${blur}px)`,
          easing: "cubic-bezier(0.2, 0.62, 0.3, 1)",
        },
        {
          offset: 0.9,
          transform: `translate3d(0, ${-(landingOffset + OVERSHOOT_PX)}px, 0)`,
          filter: "blur(0.5px)",
          easing: "cubic-bezier(0.33, 0, 0.2, 1)",
        },
        {
          offset: 1,
          transform: `translate3d(0, ${-landingOffset}px, 0)`,
          filter: "blur(0px)",
        },
      ],
      { duration, fill: "forwards" },
    );
    animationRef.current = animation;
    animation.addEventListener("finish", land, { once: true });
    frame = requestAnimationFrame(follow);

    drum?.classList.remove("is-win");
    drum?.classList.add("is-spinning");
    if (qualityRef.current === "full") housing?.classList.add("reel-rumbling");

    // `finish` is the signal, but a backgrounded tab can defer it, so a timeout
    // guarantees the reel always reports landing.
    const fallback = setTimeout(land, duration + 400);

    return () => {
      clearTimeout(fallback);
      cancelAnimationFrame(frame);
      animation.cancel();
      housing?.classList.remove("reel-rumbling");
      drum?.classList.remove("is-spinning");
    };
    // `paint` is recreated every render but reads only refs and rowHeight,
    // and rowHeight is a dependency here already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, rowHeight, duration, reducedMotion]);

  // Restyle for the reveal, and relabel an idle drum when the pool changes.
  // Neither touches the transform, so neither can disturb a spin.
  useEffect(() => {
    landedPropRef.current = landed;
    const track = trackRef.current;
    if (!track) return;
    if (!target) stripRef.current = buildStrip(pool, null, 0, RUNWAY, false);
    const m = new DOMMatrixReadOnly(getComputedStyle(track).transform);
    paint(-m.m42);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landed, pool, target]);

  return (
    // w-full: the track inside is absolutely positioned and contributes no
    // intrinsic width, so in a flex parent this would otherwise collapse.
    <div ref={drumRef} className="reel-drum relative w-full">
      {/* The cabinet lamp, behind everything. */}
      <div
        aria-hidden
        className="reel-bloom pointer-events-none absolute -inset-10 -z-10"
      />

      {/* The cabinet the drum is mounted in. */}
      <div className="rounded-[1.9rem] border border-gold-deep/45 bg-gradient-to-b from-base-700/60 via-base-800/70 to-base-900/70 p-1.5 shadow-[0_40px_90px_-30px_rgb(0_0_0/0.9)]">
        <BulbStrip quality={quality} />

        {/* The drum housing. The inset ring reads as the rim of the barrel. */}
        <div
          ref={housingRef}
          // Near-opaque with a blur behind it: the drum has to be a solid object
          // in front of the backdrop, or an uploaded photo shows straight
          // through the names as they spin.
          className="relative overflow-hidden rounded-3xl border border-gold-deep/40 bg-base-900/88 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8),inset_0_1px_0_rgb(242_214_138/0.12)] backdrop-blur-md"
          style={{ height: VISIBLE_ROWS * rowHeight }}
        >
          <div
            className="reel-mask absolute inset-0"
            style={{ height: VISIBLE_ROWS * rowHeight }}
          >
            <div ref={trackRef} className="reel-track relative">
              {/* A fixed window of rows. Position, label and style are set
                imperatively by `paint`; React renders them once. */}
              {Array.from({ length: WINDOW_ROWS }, (_, i) => (
                <div
                  key={i}
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  className="absolute inset-x-0 top-0 flex items-center justify-center px-10 text-center"
                  style={{ height: rowHeight }}
                >
                  <span
                    ref={(el) => {
                      nameRefs.current[i] = el;
                    }}
                    className="truncate"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Curvature and light. Both are static and pointer-transparent. */}
          <div
            aria-hidden
            className="reel-barrel pointer-events-none absolute inset-0 z-10"
          />
          <div
            aria-hidden
            className="reel-glare pointer-events-none absolute inset-0 z-10"
          />

          {/* Cylinder cheeks: the barrel gradient curves the drum vertically,
            these curve it horizontally. */}
          <div
            aria-hidden
            className="reel-cheek reel-cheek-left pointer-events-none absolute inset-y-0 left-0 z-10"
          />
          <div
            aria-hidden
            className="reel-cheek reel-cheek-right pointer-events-none absolute inset-y-0 right-0 z-10"
          />

          <div
            ref={paylineRef}
            aria-hidden
            className="reel-payline pointer-events-none absolute inset-x-0 z-20 overflow-hidden"
            style={{ top: CENTER_ROW * rowHeight, height: rowHeight }}
          >
            {/* Lights only once the drum has stopped, so the winning row
              becomes a lit window rather than just a bigger word. */}
            <span
              aria-hidden
              className={`reel-window absolute inset-0 ${landed ? "is-lit" : ""}`}
            />
            <span
              ref={sweepRef}
              className="absolute inset-y-0 -left-1/3 w-1/3"
              style={{
                background:
                  "linear-gradient(90deg, transparent, rgb(242 214 138 / 0.28), transparent)",
              }}
            />
          </div>

          {/* Payline markers: a chevron at each rim pointing at the winning
            row. Two thin rules read as a divider; arrows read as a payline. */}
          <div
            aria-hidden
            className="pointer-events-none absolute z-30 flex items-center"
            style={{
              top: CENTER_ROW * rowHeight,
              height: rowHeight,
              left: 6,
              fontSize: Math.round(rowHeight * 0.34),
            }}
          >
            <span className="reel-marker reel-marker-left" />
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute z-30 flex items-center"
            style={{
              top: CENTER_ROW * rowHeight,
              height: rowHeight,
              right: 6,
              fontSize: Math.round(rowHeight * 0.34),
            }}
          >
            <span className="reel-marker reel-marker-right" />
          </div>

          {/* The bezel sits above the strip but below the markers, so the frame
            crops the names and the arrows sit on top of the frame. */}
          <div
            aria-hidden
            className="reel-bezel pointer-events-none absolute inset-0 z-20"
          />
        </div>

        <BulbStrip quality={quality} />
      </div>
    </div>
  );
}

interface Strip {
  names: string[];
  /** Index of the winner in `names`, or -1 for an idle drum. */
  landingIndex: number;
}

/**
 * The runway for one spin: every name in the pool once, shuffled, then the
 * winner, then a few more so the rows under the payline are never empty.
 *
 * The shuffle is decoration and runs after the winner was committed; it is
 * seeded per spin only so consecutive spins do not scroll the same order.
 */
function buildStrip(
  pool: string[],
  target: string | null,
  spin: number,
  minRunway: number,
  sample: boolean,
): Strip {
  // Leave one copy of the winner out, so the drum does not pass them on the
  // way to landing on them.
  const decoys = [...pool];
  if (target !== null) {
    const at = decoys.indexOf(target);
    if (at !== -1) decoys.splice(at, 1);
  }
  if (decoys.length === 0) decoys.push(target ?? "—");

  const rng = new Rng(`reel-${spin}`, decoys.length);
  for (let i = decoys.length - 1; i > 0; i--) {
    const j = rng.nextBelow(i + 1);
    [decoys[i], decoys[j]] = [decoys[j], decoys[i]];
  }

  const length = sample ? minRunway : Math.max(minRunway, decoys.length);
  const runway = Array.from({ length }, (_, i) => decoys[i % decoys.length]);
  const tail = runway.slice(0, VISIBLE_ROWS);
  if (target === null) return { names: [...runway, ...tail], landingIndex: -1 };
  return {
    names: [...runway, target, ...tail],
    landingIndex: runway.length,
  };
}

/**
 * One marquee strip. Fixed node count, and every bulb is styled entirely by
 * CSS class — the only per-bulb value is the chase delay.
 */
/**
 * The marquee bulbs.
 *
 * Every bulb is an independently animating element, so this strip is the
 * single densest bit of continuous motion on the stage — the same shape of
 * thing that sank v2. It thins out as the frame budget tightens and
 * disappears entirely at minimal, rather than being the reason the budget
 * tightened in the first place.
 */
function BulbStrip({ quality }: { quality: Quality }) {
  if (quality === "minimal") return null;
  const count = quality === "reduced" ? Math.ceil(BULBS / 2) : BULBS;

  return (
    <div aria-hidden className="flex items-center justify-between px-4 py-2">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="reel-bulb"
          style={{ animationDelay: `${i * 55}ms` }}
        />
      ))}
    </div>
  );
}
