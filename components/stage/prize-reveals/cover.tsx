"use client";

import { Gift } from "lucide-react";
import type { PrizeRevealProps } from "./types";

/*
 * A · Cover lift.
 *
 * Covered: a dark card with a slow glow and a gift mark, "Up next" and how
 * many will win — the room learns how many before it learns what. Revealed:
 * the photo uncovers bottom-up behind one sweep of light, then the name and
 * the count rise in after it. Without a photo the card shows the gift mark
 * lit instead, so the beat still lands on the name.
 */
export function CoverReveal({ name, imageUrl, revealed, position, total, toWin }: PrizeRevealProps) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-[4vh] px-[4vw]">
      <p className="text-[clamp(0.9rem,2vh,1.3rem)] font-medium uppercase tracking-[0.16em] text-ink-500">
        Prize {position} of {total}
        {revealed ? "" : " · Up next"}
      </p>

      <div className="relative aspect-[16/9.4] w-[min(46vw,88vh)] overflow-hidden rounded-[1.6vw] bg-[linear-gradient(180deg,#17181c_0%,#0d0e11_100%)] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06),0_4vh_10vh_rgb(0_0_0/0.55)]">
        {revealed && imageUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL from IndexedDB */}
            <img
              src={imageUrl}
              alt=""
              className="prize-unveil absolute inset-0 size-full object-cover"
            />
            <div aria-hidden className="absolute inset-0 overflow-hidden">
              <div className="prize-sweep absolute -inset-y-[10%] left-0 w-[34%] bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.32),transparent)]" />
            </div>
          </>
        ) : (
          <div className="absolute inset-0 grid place-items-center">
            <div
              aria-hidden
              className={`absolute inset-0 bg-[radial-gradient(ellipse_50%_45%_at_50%_42%,rgb(255_255_255/0.09),transparent_70%)] ${
                revealed ? "" : "pulse-soft"
              }`}
            />
            <Gift
              aria-hidden
              strokeWidth={1}
              className={`relative size-[22%] transition-colors duration-700 ${
                revealed ? "text-ink-100" : "text-ink-500/70"
              }`}
            />
          </div>
        )}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08),inset_0_-12vh_12vh_-6vh_rgb(6_6_7/0.5)]"
        />
      </div>

      {revealed ? (
        <div className="flex flex-col items-center gap-[1.6vh] text-center">
          <span className="prize-rise name-mixed max-w-[80vw] text-[clamp(2.5rem,11vh,8rem)] font-semibold leading-none tracking-[-0.04em] text-ink-100 [text-shadow:0_0_7vh_rgb(255_255_255/0.16)] [text-wrap:balance]">
            {name}
          </span>
          <ToWin count={toWin} className="prize-rise-late" />
        </div>
      ) : (
        <ToWin count={toWin} big />
      )}
    </div>
  );
}

export function ToWin({ count, big = false, className = "" }: { count: number; big?: boolean; className?: string }) {
  return big ? (
    <p className={`flex items-baseline gap-[1.2vw] ${className}`}>
      <span className="text-[clamp(2.5rem,8vh,6rem)] font-semibold leading-none tracking-[-0.03em] text-ink-100 tabular-nums">
        {count}
      </span>
      <span className="text-[clamp(1.2rem,3vh,2rem)] text-ink-500">to be won</span>
    </p>
  ) : (
    <p className={`flex items-center gap-[1vw] text-[clamp(1.1rem,2.8vh,1.8rem)] text-ink-500 ${className}`}>
      <span aria-hidden className="h-px w-[3vw] bg-ink-100/25" />
      <span>
        <span className="text-ink-100 tabular-nums">{count}</span> to be won
      </span>
      <span aria-hidden className="h-px w-[3vw] bg-ink-100/25" />
    </p>
  );
}
