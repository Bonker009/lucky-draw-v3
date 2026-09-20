"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Rng } from "@/lib/domain/rng";
import type { Quality } from "@/lib/hooks/use-frame-budget";

const VISIBLE_ROWS = 5;
const MIN_ROW_HEIGHT = 64;
const MAX_ROW_HEIGHT = 128;
/** Share of the viewport height the drum is allowed to occupy. */
const DRUM_VIEWPORT_SHARE = 0.46;
/** Rows scrolled through before landing. Fixed, so the DOM never grows. */
const RUNWAY = 34;
const CENTER_ROW = Math.floor(VISIBLE_ROWS / 2);

/** How far past the payline the drum carries before rubber-banding back. */
const OVERSHOOT_PX = 26;

/** Peak motion blur at full tilt. Dropped entirely below full quality. */
const MAX_BLUR_PX = 11;

/** Marquee bulbs per strip. Fixed, like everything else in the drum. */
const BULBS = 16;

export interface ReelProps {
  /** Names to blur past. Only a sample of these is ever in the DOM. */
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
}

/**
 * The slot reel.
 *
 * Three deliberate properties:
 *
 * 1. The strip is a fixed RUNWAY + VISIBLE_ROWS regardless of whether there
 *    are 50 participants or 5000. v2 rendered up to 59 rows, each carrying
 *    `transition: all 0.6s`, a text-shadow and a drop-shadow, and rebuilt the
 *    whole strip on every one of its 2-second polls.
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

  // A stable decoy strip, recomputed only when the pool changes.
  const strip = useMemo(() => {
    if (pool.length === 0) return Array.from({ length: RUNWAY }, () => "—");
    const rng = new Rng("reel-decoys", pool.length);
    return Array.from(
      { length: RUNWAY },
      () => pool[rng.nextBelow(pool.length)],
    );
  }, [pool]);

  const rows = useMemo(
    () => [...strip, target ?? "—", ...strip.slice(0, VISIBLE_ROWS)],
    [strip, target],
  );

  const landingIndex = strip.length;
  // Land the winner on the payline, not at the top edge.
  const landingOffset = (landingIndex - CENTER_ROW) * rowHeight;
  const duration = reducedMotion ? 400 : durationMs;

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

    // Driven by `target` alone. Keying this on a "spinning" flag as well meant
    // the drum reset to the top the instant the engine moved to `revealing`,
    // which is exactly when the winner needs to stay under the payline.
    if (!target) {
      track.style.transform = "translate3d(0, 0, 0)";
      track.style.filter = "none";
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
      // Pin the final position and drop the filter, so the browser can retire
      // the composited layer instead of holding a blurred one all through the
      // reveal hold.
      track.style.transform = `translate3d(0, ${-landingOffset}px, 0)`;
      track.style.filter = "none";
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
      const fallback = setTimeout(land, duration + 400);
      return () => {
        clearTimeout(fallback);
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

    drum?.classList.remove("is-win");
    drum?.classList.add("is-spinning");
    if (qualityRef.current === "full") housing?.classList.add("reel-rumbling");

    // `finish` is the signal, but a backgrounded tab can defer it, so a timeout
    // guarantees the reel always reports landing.
    const fallback = setTimeout(land, duration + 400);

    return () => {
      clearTimeout(fallback);
      animation.cancel();
      housing?.classList.remove("reel-rumbling");
      drum?.classList.remove("is-spinning");
    };
  }, [target, landingOffset, duration, reducedMotion]);

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
          <div ref={trackRef} className="reel-track">
            {rows.map((name, i) => (
              <div
                key={`${i}-${name}`}
                className="flex items-center justify-center px-10 text-center"
                style={{ height: rowHeight }}
              >
                <span
                  ref={i === landingIndex ? winnerRef : undefined}
                  className={
                    i === landingIndex
                      ? `truncate font-bold text-gold-bright ${
                          landed
                            ? "[text-shadow:0_0_36px_rgb(242_214_138/0.55)]"
                            : ""
                        }`
                      : "truncate font-medium text-ink-500"
                  }
                  // Sized off the row so the names keep their proportion when
                  // the drum shrinks to fit a short screen. The winner grows a
                  // little once it lands — this row is the reveal.
                  style={{
                    fontSize: Math.round(
                      rowHeight *
                        (i === landingIndex ? (landed ? 0.58 : 0.5) : 0.42),
                    ),
                  }}
                >
                  {name}
                </span>
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

        <div
          ref={paylineRef}
          aria-hidden
          className="reel-payline pointer-events-none absolute inset-x-0 z-20 overflow-hidden"
          style={{ top: CENTER_ROW * rowHeight, height: rowHeight }}
        >
          <span
            ref={sweepRef}
            className="absolute inset-y-0 -left-1/3 w-1/3"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgb(242 214 138 / 0.28), transparent)",
            }}
          />
        </div>

        {/* Gold ticks marking the payline at both rims. */}
        <div
          aria-hidden
          className="pointer-events-none absolute z-20 flex flex-col justify-between"
          style={{
            top: CENTER_ROW * rowHeight,
            height: rowHeight,
            left: 0,
            width: 18,
          }}
        >
          <span className="h-px w-full bg-gold/70" />
          <span className="h-px w-full bg-gold/70" />
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute z-20 flex flex-col justify-between"
          style={{
            top: CENTER_ROW * rowHeight,
            height: rowHeight,
            right: 0,
            width: 18,
          }}
        >
          <span className="h-px w-full bg-gold/70" />
          <span className="h-px w-full bg-gold/70" />
        </div>
        </div>

        <BulbStrip quality={quality} />
      </div>
    </div>
  );
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
