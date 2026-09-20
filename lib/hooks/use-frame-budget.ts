"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

export type Quality = "full" | "reduced" | "minimal";

/**
 * Watches the frame rate and steps effects down when the machine cannot keep
 * up. v2 shipped a performance monitor and never called it, so nothing noticed
 * the projector laptop dropping frames until it was on screen.
 */
export function useFrameBudget(enabled = true): Quality {
  const [quality, setQuality] = useState<Quality>("full");

  useEffect(() => {
    if (!enabled) return;

    let raf = 0;
    let frames = 0;
    let windowStart = performance.now();
    let slowWindows = 0;
    let fastWindows = 0;
    let current: Quality = "full";

    const tick = (now: number) => {
      frames++;
      const elapsed = now - windowStart;

      if (elapsed >= 1000) {
        const fps = (frames * 1000) / elapsed;
        frames = 0;
        windowStart = now;

        if (fps < 50) {
          slowWindows++;
          fastWindows = 0;
        } else if (fps > 58) {
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
