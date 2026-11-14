"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Rng } from "@/lib/domain/rng";
import { canvasMeasure, fitFontSize } from "@/lib/stage/fit-text";
import type { RevealProps } from "./types";

/*
 * The classic reel: the original single drum, restyled. Kept as a style
 * because it is what people expect a lucky draw to look like — but at a big
 * event it streams hundreds of names past faster than anyone can read, which
 * is why the name wall is the default.
 *
 * The engine of it is unchanged from the cabinet era, and so are the reasons:
 *
 * 1. The strip is virtual. Each spin shuffles the whole pool into a runway
 *    that ends on the winner, so everyone goes past the payline; only
 *    `WINDOW_ROWS` nodes exist and are re-labelled each frame. v3 first used a
 *    fixed sample of 34 decoys, and at a 200-person event most people never
 *    appeared at all, which reads as a rigged draw.
 * 2. The spin is one Web Animations API animation on one node, so nothing
 *    else on the page can disturb it, and the winner arrives as a prop.
 * 3. The effect is keyed on the target alone. `quality` and the duration are
 *    read through refs: as a dependency, a frame-budget downgrade re-ran the
 *    spin mid-reveal and slid the winner off the payline a second after it
 *    landed, and the duration changes the moment the engine moves on to
 *    revealing (its remaining count drops), which would do the same.
 *
 * What changed: no cabinet, bulbs or bezel — the Keynote stage is type on a
 * dark field, and the payline is two hairlines. The winning row is only
 * styled as the winner once `landed`, never while it is still braking.
 */

const VISIBLE_ROWS = 5;
const WINDOW_ROWS = VISIBLE_ROWS + 2;
const CENTER_ROW = Math.floor(VISIBLE_ROWS / 2);
const RUNWAY = 34;
const OVERSHOOT_PX = 26;
const MAX_BLUR_PX = 5;

interface Strip {
  names: string[];
  landingIndex: number;
}

export function ClassicReel({
  pool,
  targetId,
  landed,
  durationMs,
  reducedMotion,
  quality,
  onTick,
}: RevealProps) {
  const live = useRef({ pool, durationMs, quality, onTick });
  useLayoutEffect(() => {
    live.current = { pool, durationMs, quality, onTick };
  });

  const targetName = targetId
    ? (pool.find((p) => p.id === targetId)?.name ?? null)
    : null;

  const boxRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const nameRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const stripRef = useRef<Strip>({ names: [], landingIndex: -1 });
  const spinCount = useRef(0);
  const landedRef = useRef(landed);
  const [rowHeight, setRowHeight] = useState(140);

  // Rows sized from the box the reel actually has, between spins only.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(([entry]) => {
      const h = entry.contentRect.height;
      setRowHeight(Math.max(56, Math.min(200, Math.floor(h / (VISIBLE_ROWS + 0.6)))));
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  const fitCache = useRef(new Map<string, number>());
  const winnerPx = (text: string, width: number, rh: number) => {
    const key = `${text}|${width}|${rh}`;
    const hit = fitCache.current.get(key);
    if (hit !== undefined) return hit;
    const family = getComputedStyle(trackRef.current ?? document.body).fontFamily;
    const px = fitFontSize(text, {
      // The row's horizontal padding is 5vw each side.
      maxWidth: width - (window.innerWidth * 0.1),
      maxLines: 1,
      max: Math.round(rh * 0.66),
      min: Math.round(rh * 0.3),
      measure: canvasMeasure(600, family),
    });
    fitCache.current.set(key, px);
    return px;
  };

  const paint = (y: number) => {
    const { names, landingIndex } = stripRef.current;
    const first = Math.max(0, Math.floor(y / rowHeight) - 1);
    const isLanded = landedRef.current;
    for (let i = 0; i < WINDOW_ROWS; i++) {
      const row = rowRefs.current[i];
      const label = nameRefs.current[i];
      if (!row || !label) continue;
      const index = first + i;
      const top = `translate3d(0, ${index * rowHeight}px, 0)`;
      if (row.style.transform !== top) row.style.transform = top;
      const text = names[index] ?? "";
      if (label.textContent !== text) label.textContent = text;
      const isWinner = isLanded && index === landingIndex;
      const distance = Math.abs(index * rowHeight - y - CENTER_ROW * rowHeight) / rowHeight;
      const size = isWinner ? 0.66 : distance < 0.5 ? 0.56 : 0.4;
      // The landed winner shrinks to fit its row instead of being cut off;
      // decoys may truncate. Measured once per landing, not per frame.
      const fontSize = `${
        isWinner ? winnerPx(text, row.clientWidth, rowHeight) : Math.round(rowHeight * size)
      }px`;
      if (label.style.fontSize !== fontSize) label.style.fontSize = fontSize;
      const state = isWinner ? "win" : isLanded ? "dim" : "spin";
      if (label.dataset.state !== state) label.dataset.state = state;
    }
  };

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    landedRef.current = false;

    const names = live.current.pool.map((p) => p.name);
    spinCount.current += 1;
    stripRef.current = buildStrip(
      names,
      targetName,
      spinCount.current,
      reducedMotion ? VISIBLE_ROWS * 2 : RUNWAY,
      reducedMotion,
    );
    const { landingIndex } = stripRef.current;
    const landingOffset = Math.max(0, landingIndex - CENTER_ROW) * rowHeight;

    let frame = 0;
    let lastRow = 0;
    const follow = () => {
      const m = new DOMMatrixReadOnly(getComputedStyle(track).transform);
      const y = -m.m42;
      paint(y);
      const row = Math.floor(y / rowHeight + 0.5);
      if (row !== lastRow) {
        lastRow = row;
        live.current.onTick?.();
      }
      frame = requestAnimationFrame(follow);
    };

    if (!targetName) {
      track.style.transform = "translate3d(0, 0, 0)";
      track.style.filter = "none";
      paint(0);
      return;
    }

    const duration = reducedMotion ? 400 : live.current.durationMs;
    const blur = reducedMotion || live.current.quality !== "full" ? 0 : MAX_BLUR_PX;

    const settle = () => {
      cancelAnimationFrame(frame);
      track.style.transform = `translate3d(0, ${-landingOffset}px, 0)`;
      track.style.filter = "none";
      paint(landingOffset);
    };

    const keyframes: Keyframe[] = reducedMotion
      ? [
          { transform: "translate3d(0, 0, 0)" },
          { transform: `translate3d(0, ${-landingOffset}px, 0)` },
        ]
      : [
          { offset: 0, transform: "translate3d(0, 0, 0)", filter: "blur(0px)", easing: "cubic-bezier(0.45, 0, 0.9, 0.4)" },
          { offset: 0.14, transform: `translate3d(0, ${-landingOffset * 0.09}px, 0)`, filter: `blur(${blur}px)`, easing: "linear" },
          { offset: 0.68, transform: `translate3d(0, ${-landingOffset * 0.74}px, 0)`, filter: `blur(${blur}px)`, easing: "cubic-bezier(0.2, 0.62, 0.3, 1)" },
          { offset: 0.9, transform: `translate3d(0, ${-(landingOffset + OVERSHOOT_PX)}px, 0)`, filter: "blur(0.5px)", easing: "cubic-bezier(0.33, 0, 0.2, 1)" },
          { offset: 1, transform: `translate3d(0, ${-landingOffset}px, 0)`, filter: "blur(0px)" },
        ];
    const animation = track.animate(keyframes, {
      duration,
      fill: "forwards",
      easing: reducedMotion ? "cubic-bezier(0.16, 1, 0.3, 1)" : "linear",
    });
    animation.addEventListener("finish", settle, { once: true });
    frame = requestAnimationFrame(follow);
    // `finish` can be deferred in a background tab; the timeout guarantees
    // the drum always ends on the payline.
    const fallback = setTimeout(settle, duration + 400);

    return () => {
      clearTimeout(fallback);
      cancelAnimationFrame(frame);
      animation.cancel();
    };
    // Keyed on the target id — not its name, or two winners who share a name
    // in a row would never spin — and on row height, which only changes
    // between spins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, rowHeight, reducedMotion]);

  // The reveal restyles the strip in place; it never touches the transform.
  useEffect(() => {
    landedRef.current = landed;
    const track = trackRef.current;
    if (!track) return;
    if (!targetName) {
      stripRef.current = buildStrip(pool.map((p) => p.name), null, 0, RUNWAY, false);
    }
    const m = new DOMMatrixReadOnly(getComputedStyle(track).transform);
    paint(-m.m42);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landed, pool, targetId]);

  const won = Boolean(targetName && landed);
  const line = won
    ? "bg-gradient-to-r from-transparent via-gold/45 to-transparent"
    : "bg-gradient-to-r from-transparent via-ink-100/12 to-transparent";

  return (
    <div ref={boxRef} className="relative h-full min-h-0 w-full">
      {won ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 45% 22% at 50% 50%, rgb(242 214 138 / 0.16), transparent 75%)",
          }}
        />
      ) : null}
      <div
        className="reel-mask absolute inset-x-0 top-1/2 -translate-y-1/2 overflow-hidden"
        style={{ height: VISIBLE_ROWS * rowHeight }}
      >
        <div ref={trackRef} className="relative will-change-[transform,filter]">
          {Array.from({ length: WINDOW_ROWS }, (_, i) => (
            <div
              key={i}
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
              className="absolute inset-x-0 top-0 flex items-center justify-center px-[5vw] text-center"
              style={{ height: rowHeight }}
            >
              <span
                ref={(el) => {
                  nameRefs.current[i] = el;
                }}
                data-state="spin"
                className="name-mixed truncate font-semibold tracking-[-0.03em] text-ink-100 data-[state=dim]:font-medium data-[state=dim]:text-ink-500 data-[state=win]:text-gold-bright data-[state=win]:[text-shadow:0_0_6vh_rgb(242_214_138/0.4)]"
              />
            </div>
          ))}
        </div>
      </div>

      {/* The payline: two hairlines and a tick at each end. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-[3vw] top-1/2"
        style={{ height: rowHeight, marginTop: -rowHeight / 2 }}
      >
        <span className={`absolute inset-x-0 top-0 h-px ${line}`} />
        <span className={`absolute inset-x-0 bottom-0 h-px ${line}`} />
        <span className={`absolute -top-px left-0 h-[3px] w-[1.5vw] rounded-full ${won ? "bg-gold-bright" : "bg-ink-100/30"}`} />
        <span className={`absolute -top-px right-0 h-[3px] w-[1.5vw] rounded-full ${won ? "bg-gold-bright" : "bg-ink-100/30"}`} />
      </div>

      {won && targetName ? (
        <span data-testid="reveal-winner" className="sr-only">
          {targetName}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The runway for one spin: every name in the pool once, shuffled, then the
 * winner, then a few more so the rows under the payline are never empty.
 * The shuffle is decoration on an already-committed result.
 */
function buildStrip(
  pool: string[],
  target: string | null,
  spin: number,
  minRunway: number,
  sample: boolean,
): Strip {
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
  return { names: [...runway, target, ...tail], landingIndex: runway.length };
}
