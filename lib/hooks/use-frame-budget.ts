"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

export type Quality = "full" | "reduced" | "minimal";

/** Refresh rates a screen is actually driven at, up to the 60 the show needs. */
const RATES = [60, 50, 48, 30, 25, 24];

/**
 * The refresh rate the browser is being given, from the shortest gap between
 * two frames. A machine that is struggling still lands the odd frame on time;
 * a display that only refreshes 30 times a second never does. Capped at 60:
 * a 144Hz monitor dropping to 100 has not dropped anything the show needs.
 */
export function refreshRateFrom(minFrameMs: number): number {
  const fps = 1000 / Math.max(minFrameMs, 1);
  // 8% slack: frame timestamps jitter by a millisecond or two.
  return RATES.find((r) => r <= fps * 1.08) ?? RATES[RATES.length - 1];
}

/** A gap this long between frames means the page was not being drawn at all. */
const STALL_MS = 250;

/**
 * Watches the frame rate and steps effects down when the machine cannot keep
 * up. v2 shipped a performance monitor and never called it, so nothing noticed
 * the projector laptop dropping frames until it was on screen.
 *
 * "Cannot keep up" is measured against the screen's own refresh rate, not
 * against 60. A projector on 4K HDMI, or a laptop on battery with the
 * browser's energy saver on, runs at a steady 30: this used to call that slow,
 * and four seconds after the page opened the wall had lost its sweep and the
 * stage its gems, on a machine that was not dropping a single frame.
 */
export function useFrameBudget(enabled = true): Quality {
  const [quality, setQuality] = useState<Quality>("full");

  useEffect(() => {
    if (!enabled) return;

    let raf = 0;
    let frames = 0;
    let activeMs = 0;
    let last = performance.now();
    let minFrameMs = Infinity;
    let slowWindows = 0;
    let fastWindows = 0;
    let current: Quality = "full";

    const tick = (now: number) => {
      const gap = now - last;
      last = now;
      // A long gap is not a slow frame, it is the browser not asking for
      // frames: the window is covered or the tab is in the background (the
      // presenter is on /control) and it is throttled to a frame now and
      // then. Counting those stripped the show to `minimal`, and it took ten
      // good seconds back in front to earn the sweep again. Only time spent
      // actually drawing is measured.
      if (gap >= STALL_MS || gap <= 0 || document.visibilityState !== "visible") {
        raf = requestAnimationFrame(tick);
        return;
      }
      frames++;
      activeMs += gap;
      minFrameMs = Math.min(minFrameMs, gap);

      if (activeMs >= 1000) {
        const fps = (frames * 1000) / activeMs;
        const rate = refreshRateFrom(minFrameMs);
        frames = 0;
        activeMs = 0;

        if (fps < rate * 0.83) {
          slowWindows++;
          fastWindows = 0;
        } else if (fps > rate * 0.95) {
          fastWindows++;
          slowWindows = 0;
        }

        // Two consecutive bad seconds before stepping down, so one GC pause
        // does not visibly strip the show.
        if (slowWindows >= 2) {
          const next: Quality = current === "full" ? "reduced" : "minimal";
          if (next !== current) {
            current = next;
            setQuality(next);
          }
          slowWindows = 0;
        } else if (fastWindows >= 5 && current !== "full") {
          current = current === "minimal" ? "reduced" : "full";
          setQuality(current);
          fastWindows = 0;
        }
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);

  return quality;
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function usePrefersReducedMotion(): boolean {
  // A media query is external state, so subscribe to it rather than mirroring
  // it into React state from an effect.
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}
