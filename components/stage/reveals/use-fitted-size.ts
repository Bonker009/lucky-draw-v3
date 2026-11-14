"use client";

import { useEffect, useMemo, useState } from "react";
import { canvasMeasure, fitFontSize } from "@/lib/stage/fit-text";

/**
 * The largest font size (px) at which `text` fits the box it is rendered in,
 * in `maxLines` lines — for a winner's name, which is shrunk, never truncated.
 *
 * Returns a callback ref for the box and the size. A callback ref rather than
 * a ref object, because the box usually mounts late (a card face that only
 * exists once turned) and an effect keyed on a ref object never sees it.
 * `maxVh` caps the size relative to the viewport height, the way all stage
 * type is sized for whatever projector it lands on.
 */
export function useFittedSize(
  text: string | null,
  {
    maxLines,
    maxVh,
    maxPx = 200,
    minPx = 28,
    weight = 600,
  }: { maxLines: number; maxVh: number; maxPx?: number; minPx?: number; weight?: number },
): [(el: HTMLElement | null) => void, number | null] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [box, setBox] = useState({ width: 0, vh: 0, family: "sans-serif" });

  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setBox({
        width: entry.contentRect.width,
        vh: window.innerHeight / 100,
        family: getComputedStyle(el).fontFamily || "sans-serif",
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  const px = useMemo(() => {
    if (!text || box.width === 0) return null;
    return fitFontSize(text, {
      maxWidth: box.width * 0.98,
      maxLines,
      max: Math.min(maxPx, maxVh * box.vh),
      min: minPx,
      measure: canvasMeasure(weight, box.family),
    });
  }, [text, box, maxLines, maxVh, maxPx, minPx, weight]);

  return [setEl, px];
}
