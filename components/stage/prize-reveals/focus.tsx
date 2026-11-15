"use client";

import { Gift } from "lucide-react";
import type { PrizeRevealProps } from "./types";

/*
 * E · Focus pull.
 *
 * Covered: the photo heavily blurred and grey inside viewfinder brackets,
 * "What is it?" and how many will win — the room guesses from the shape.
 * Revealed: it racks into focus and colour over a second and a half, the
 * focus box closes in, and the name replaces the question.
 *
 * The blur is a CSS filter transition on one image, so it costs one layer;
 * under reduced motion the change is a cut.
 */
export function FocusReveal({ name, imageUrl, revealed, position, total, toWin, reducedMotion }: PrizeRevealProps) {
  const tr = (prop: string, ms: number) => (reducedMotion ? "none" : `${prop} ${ms}ms cubic-bezier(0.4,0,0.2,1)`);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-[4vh] px-[4vw]">
      <div className="relative aspect-video w-[min(58vw,104vh)] overflow-hidden rounded-[0.4vw] bg-[#0b0c0e]">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob: URL from IndexedDB
          <img
            src={imageUrl}
            alt=""
            className="absolute inset-0 size-full object-cover"
            style={{
              filter: revealed ? "none" : "blur(38px) saturate(0) brightness(0.6)",
              transform: revealed ? "scale(1)" : "scale(1.12)",
              transition: [tr("filter", 1600), tr("transform", 1600)].join(", "),
            }}
          />
        ) : (
          <div
            className="absolute inset-0 grid place-items-center bg-[radial-gradient(ellipse_50%_50%_at_50%_45%,#2a2c40,#0d0e14)]"
            style={{ filter: revealed ? "none" : "blur(18px)", transition: tr("filter", 1600) }}
          >
            <Gift aria-hidden strokeWidth={1} className="size-[22vh] text-ink-100/70" />
          </div>
        )}

        <div aria-hidden className="pointer-events-none absolute inset-[3%]">
          {(["left-0 top-0 border-l-[3px] border-t-[3px]", "right-0 top-0 border-r-[3px] border-t-[3px]", "bottom-0 left-0 border-b-[3px] border-l-[3px]", "bottom-0 right-0 border-b-[3px] border-r-[3px]"] as const).map((c) => (
            <span key={c} className={`absolute size-[6vh] border-ink-100/85 ${c}`} />
          ))}
          <span className="absolute left-[8vh] top-[2vh] font-mono text-[clamp(0.8rem,1.8vh,1.2rem)] font-semibold tracking-[0.08em] text-ink-100/90 [text-shadow:0_1px_8px_rgb(0_0_0/0.6)]">
            PRIZE {pad(position)} / {pad(total)}
          </span>
          <span className="absolute right-[8vh] top-[2vh] inline-flex items-center gap-[0.8vh] font-mono text-[clamp(0.8rem,1.8vh,1.2rem)] font-semibold tracking-[0.08em] text-ink-100/90 [text-shadow:0_1px_8px_rgb(0_0_0/0.6)]">
            <span className={`size-[1vh] rounded-full ${revealed ? "bg-ink-100" : "pulse-soft bg-ink-500"}`} />
            {revealed ? "IN FOCUS" : "FOCUSING"}
          </span>
          <div className="absolute inset-0 grid place-items-center">
            <span
              className="rounded-[0.3vw] border-2 border-ink-100/60"
              style={{
                width: revealed ? "16%" : "34%",
                height: revealed ? "18%" : "40%",
                opacity: revealed ? 0 : 1,
                transition: [tr("width", 1000), tr("height", 1000), tr("opacity", 600)].join(", "),
              }}
            />
          </div>
        </div>
      </div>

      <div className="relative grid h-[16vh] w-full place-items-center">
        <div
          className="absolute flex flex-col items-center gap-[1.4vh] text-center"
          style={{ opacity: revealed ? 0 : 1, transition: tr("opacity", 500) }}
        >
          <span className="text-[clamp(2rem,7vh,5rem)] font-semibold leading-none tracking-[-0.03em] text-ink-100">
            What is it?
          </span>
          <span className="text-[clamp(1.1rem,2.8vh,1.8rem)] text-ink-500">
            <span className="text-ink-100 tabular-nums">{toWin}</span> to be won
          </span>
        </div>
        {revealed ? (
          <div className="prize-rise absolute flex flex-col items-center gap-[1.4vh] text-center">
            <span className="name-mixed max-w-[80vw] truncate text-[clamp(2.5rem,10vh,7.5rem)] font-semibold leading-none tracking-[-0.045em] text-ink-100 [text-shadow:0_0_7vh_rgb(255_255_255/0.15)]">
              {name}
            </span>
            <span className="text-[clamp(1.1rem,2.8vh,1.8rem)] text-ink-500">
              <span className="text-ink-100 tabular-nums">{toWin}</span> to be won
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
