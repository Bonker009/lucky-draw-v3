"use client";

import { Gift } from "lucide-react";
import type { PrizeRevealProps } from "./types";

const SLATS = 12;

/*
 * D · Louvre shutter.
 *
 * The photo fills the whole stage behind twelve vertical slats. Covered: the
 * slats are shut and carry "Up next · prize 2 of 6 · 3 to be won". Revealed:
 * they turn open left to right, and the name lands bottom-left over a scrim
 * once the picture is out. The most cinematic of the five; it needs a photo
 * to earn it — without one the slats open on a lit gift mark instead.
 */
export function ShutterReveal({ name, imageUrl, revealed, position, total, toWin, reducedMotion }: PrizeRevealProps) {
  const t = (ms: number) => (reducedMotion ? "none" : `${ms}ms`);
  return (
    <div className="relative h-full w-full overflow-hidden rounded-[1vw]">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- blob: URL from IndexedDB
        <img src={imageUrl} alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(ellipse_50%_50%_at_50%_45%,#24263a,#0d0e14)]">
          <Gift aria-hidden strokeWidth={1} className="size-[24vh] text-ink-100/70" />
        </div>
      )}
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(0deg,rgb(10_10_20/0.92)_0%,rgb(10_10_20/0.5)_32%,transparent_60%)]"
      />

      <div aria-hidden className="absolute inset-0 grid [perspective:2200px]" style={{ gridTemplateColumns: `repeat(${SLATS}, minmax(0, 1fr))` }}>
        {Array.from({ length: SLATS }, (_, i) => (
          <div
            key={i}
            className="bg-[linear-gradient(90deg,#1a1d2e_0%,#121423_55%,#0b0c16_100%)] shadow-[inset_-1px_0_0_rgb(0_0_0/0.9),inset_1px_0_0_rgb(255_255_255/0.04)]"
            style={{
              transform: `rotateY(${revealed ? 86 : 0}deg)`,
              transition: reducedMotion ? "none" : "transform 900ms cubic-bezier(0.6,0,0.2,1)",
              transitionDelay: reducedMotion ? "0ms" : `${revealed ? i * 70 : (SLATS - 1 - i) * 30}ms`,
            }}
          />
        ))}
      </div>

      {/* Covered: the tease, on the slats. */}
      <div
        className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-[2vh] text-center"
        style={{ opacity: revealed ? 0 : 1, transition: `opacity ${t(500)}` }}
      >
        <span className="text-[clamp(0.9rem,2vh,1.3rem)] font-medium uppercase tracking-[0.16em] text-ink-500">
          Up next
        </span>
        <span className="text-[clamp(2.5rem,10vh,7rem)] font-semibold leading-none tracking-[-0.04em] text-ink-100">
          Prize {position} of {total}
        </span>
        <span className="text-[clamp(1.1rem,2.8vh,1.8rem)] text-ink-500">
          <span className="text-ink-100 tabular-nums">{toWin}</span> to be won
        </span>
      </div>

      {/* Revealed: the name, once the picture is out. */}
      <div
        className="pointer-events-none absolute bottom-[8vh] left-[5vw] flex max-w-[70vw] flex-col gap-[1.6vh]"
        style={{
          opacity: revealed ? 1 : 0,
          transform: revealed ? "none" : "translateY(3vh)",
          transition: `opacity ${t(600)}, transform ${t(700)}`,
          transitionDelay: revealed && !reducedMotion ? "800ms" : "0ms",
        }}
      >
        <span className="text-[clamp(0.9rem,2vh,1.3rem)] font-medium uppercase tracking-[0.16em] text-ink-300">
          Prize {position} of {total}
        </span>
        {revealed ? (
          <span className="name-mixed text-[clamp(3rem,14vh,10rem)] font-semibold leading-[0.92] tracking-[-0.05em] text-ink-100 [text-shadow:0_0.4vh_6vh_rgb(0_0_0/0.5)] [text-wrap:balance]">
            {name}
          </span>
        ) : null}
        <span className="text-[clamp(1.1rem,2.8vh,1.8rem)] text-ink-300">
          <span className="font-semibold text-ink-100 tabular-nums">{toWin}</span> to be won
        </span>
      </div>
    </div>
  );
}
