"use client";

import { Check } from "lucide-react";
import { BlurFade } from "@/components/ui/blur-fade";
import { useAssetUrl } from "@/lib/hooks/use-asset-url";
import { ToWin } from "./cover";
import type { LineupEntry, PrizeRevealProps } from "./types";

/** More than this and the row would shrink past readable; it windows instead. */
const MAX_CARDS = 7;

/*
 * B · The running order.
 *
 * Covered: every prize of the night in a row — drawn ones dimmed with their
 * photo, the next one lifted with "Up next", the rest still covered with only
 * their number. Revealed: the prize steps out of the row into a large photo
 * with its name, and its slot stays outlined so the room can see where in the
 * evening it is.
 */
export function LineupReveal({ name, imageUrl, revealed, position, total, toWin, lineup }: PrizeRevealProps) {
  // A window around the current prize when the night has many.
  const current = Math.max(0, lineup.findIndex((p) => p.state === "current"));
  const start = Math.min(Math.max(0, current - 2), Math.max(0, lineup.length - MAX_CARDS));
  const cards = lineup.slice(start, start + MAX_CARDS);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-[6vh] px-[4vw]">
      {revealed ? (
        <BlurFade duration={0.6} offset={30} direction="up" className="flex items-center gap-[4vw]">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- blob: URL from IndexedDB
            <img
              src={imageUrl}
              alt=""
              className="aspect-[16/10] w-[min(40vw,72vh)] rounded-[1.6vw] object-cover shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08),0_4vh_10vh_rgb(0_0_0/0.55)]"
            />
          ) : null}
          <div className="flex max-w-[36vw] flex-col gap-[2vh]">
            <span className="text-[clamp(0.9rem,2vh,1.3rem)] font-medium uppercase tracking-[0.16em] text-ink-500">
              Prize {position} of {total}
            </span>
            <span className="name-mixed text-[clamp(2.5rem,11vh,8rem)] font-semibold leading-[0.95] tracking-[-0.045em] text-ink-100 [text-shadow:0_0_7vh_rgb(255_255_255/0.14)] [text-wrap:balance]">
              {name}
            </span>
            <span className="text-[clamp(1.1rem,2.8vh,1.8rem)] text-ink-500">
              <span className="text-[1.6em] font-semibold text-ink-100 tabular-nums">{toWin}</span> to be won
            </span>
          </div>
        </BlurFade>
      ) : (
        <div className="flex flex-col items-center gap-[1.5vh] text-center">
          <span className="text-[clamp(0.9rem,2vh,1.3rem)] font-medium uppercase tracking-[0.16em] text-ink-500">
            Tonight&apos;s prizes
          </span>
          <span className="text-[clamp(2rem,7vh,5rem)] font-semibold leading-tight tracking-[-0.03em] text-ink-100">
            Next up: prize {position} of {total}
          </span>
          <ToWin count={toWin} />
        </div>
      )}

      <ol aria-label="Prizes in running order" className="flex items-end justify-center gap-[1.4vw]">
        {cards.map((p, i) => (
          <LineupCard key={p.id} entry={p} number={start + i + 1} small={revealed} />
        ))}
      </ol>
    </div>
  );
}

function LineupCard({ entry, number, small }: { entry: LineupEntry; number: number; small: boolean }) {
  const url = useAssetUrl(entry.state === "done" ? entry.imageAssetId : undefined);
  const current = entry.state === "current";
  // Revealed: the current prize has left its slot; an outline marks the gap.
  const empty = current && small;
  const size = small ? "h-[17vh] w-[12vh]" : "h-[30vh] w-[22vh]";
  return (
    <li className="flex flex-col items-center gap-[1.2vh]">
      <div
        className={`relative grid ${size} place-items-center overflow-hidden rounded-[1.2vw] transition-all duration-700 ease-out ${
          empty
            ? "shadow-[inset_0_0_0_2px_rgb(255_255_255/0.18)]"
            : current
              ? "-translate-y-[3vh] bg-[linear-gradient(180deg,#17181c,#0d0e11)] shadow-[inset_0_0_0_2px_rgb(255_255_255/0.7),0_0_6vh_rgb(255_255_255/0.12),0_3vh_8vh_rgb(0_0_0/0.6)]"
              : "bg-[linear-gradient(180deg,#17181c,#0d0e11)] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06),0_2vh_5vh_rgb(0_0_0/0.5)]"
        } ${entry.state === "done" ? "opacity-45" : ""}`}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob: URL from IndexedDB
          <img src={url} alt="" className="absolute inset-0 size-full object-cover" />
        ) : null}
        {empty ? null : entry.state === "done" ? (
          <span className="absolute bottom-[1vh] left-[1vh] inline-flex items-center gap-1 rounded-full bg-[rgb(6_6_7/0.75)] px-[0.8vh] py-[0.3vh] text-[clamp(0.7rem,1.4vh,0.95rem)] text-ink-300">
            <Check aria-hidden className="size-[1em]" />
            Drawn
          </span>
        ) : (
          <span
            className={`font-mono font-semibold ${small ? "text-[4vh]" : "text-[7vh]"} ${
              current ? "text-ink-100" : "text-ink-100/20"
            }`}
          >
            {number}
          </span>
        )}
      </div>
      <span className="flex max-w-[22vh] flex-col items-center gap-[0.4vh] text-center">
        <span className="text-[clamp(0.65rem,1.3vh,0.9rem)] font-medium uppercase tracking-[0.12em] text-ink-500">
          {current && !small ? "Up next" : entry.state === "done" ? "Drawn" : current ? "On stage" : ""}
        </span>
        <span className={`truncate text-[clamp(0.85rem,1.9vh,1.3rem)] ${current ? "text-ink-100" : "text-ink-500"}`}>
          {/* The current prize stays a question mark until it is revealed. */}
          {current && !small ? "?" : entry.state === "upcoming" ? `Prize ${number}` : entry.name}
        </span>
      </span>
    </li>
  );
}
