"use client";

import { useMemo } from "react";
import type { RevealProps } from "./types";

/*
 * The envelope: a fan of name cards, one card drawn out face down, then turned
 * over to show the winner. The most ceremonial style — it reads like an awards
 * night rather than a machine.
 *
 * The face of the drawn card is not rendered at all until `landed`: before
 * that it is a patterned back and nothing else, so the name cannot leak into
 * the DOM early. The fan shows a slice of the roster (never the winner — a
 * fan card carrying the winner's name would read as a hint), with the full
 * headcount written above it.
 *
 * Motion is CSS transitions on two state changes (drawn, turned), not a
 * timeline, so there is nothing to keep in step with the engine: the card is
 * lifted as soon as a target exists and turned exactly when the engine says.
 */

/** Few enough that each card shows a readable name, not a sliver. */
const FAN = 17;
const SPREAD_DEG = 112;

function sample<T extends { id: string }>(items: T[], n: number, skip: string | null, key: string): T[] {
  const pool = items.filter((i) => i.id !== skip);
  if (pool.length <= n) return pool;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  const step = Math.max(1, Math.floor(pool.length / n));
  const start = (h >>> 0) % pool.length;
  return Array.from({ length: n }, (_, i) => pool[(start + i * step) % pool.length]);
}

export function Envelope({ pool, targetId, landed, reducedMotion }: RevealProps) {
  const targetName = targetId
    ? (pool.find((p) => p.id === targetId)?.name ?? null)
    : null;
  const drawing = Boolean(targetId);
  const turned = Boolean(targetId && landed);

  const fan = useMemo(
    () => sample(pool, FAN, targetId, targetId ?? "idle"),
    // Re-deal only when a new card is drawn, not on every roster fold.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetId, pool.length],
  );

  const slowly = reducedMotion ? "duration-0" : "duration-700";
  const status = turned
    ? "The card is turned"
    : drawing
      ? "One card drawn, face down"
      : `${pool.length} names in the deck`;

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden">
      <p
        role="status"
        className="absolute inset-x-0 top-[2vh] text-center text-[min(1.8vh,1.15rem)] font-medium uppercase tracking-[0.14em] text-ink-500"
      >
        {status}
      </p>

      {/* The fan. Each card hangs from a pivot far below the screen, so a
          single rotate per card draws the arc. */}
      <div
        aria-hidden
        className={`absolute inset-x-0 bottom-0 h-[42vh] transition-[opacity,translate] ${slowly} ${
          turned ? "translate-y-[8vh] opacity-20" : "opacity-100"
        }`}
      >
        {fan.map((p, i) => {
          const angle = -SPREAD_DEG / 2 + (SPREAD_DEG * i) / Math.max(1, fan.length - 1);
          const hidden = drawing && i === Math.floor(fan.length / 2);
          return (
            <div
              key={p.id}
              className={`absolute bottom-[4vh] flex h-[19vh] w-[13vh] flex-col justify-between rounded-[1.2vh] bg-gradient-to-b from-[#1c1d22] to-[#131418] p-[1.4vh] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.09),0_1vh_2.4vh_rgb(0_0_0/0.5)] transition-opacity ${slowly} ${
                hidden ? "opacity-0" : ""
              }`}
              style={{
                transform: `translateX(-50%) rotate(${angle}deg)`,
                transformOrigin: "50% 95vh",
                left: "50%",
              }}
            >
              <span className="line-clamp-2 text-[min(1.5vh,1rem)] leading-snug font-medium text-ink-300">
                {p.name}
              </span>
              <span className="h-px w-[2.4vh] bg-ink-100/25" />
            </div>
          );
        })}
      </div>

      {/* The drawn card. Lifts out of the fan face down, then turns over. */}
      <div
        className={`absolute left-1/2 top-1/2 [perspective:2400px] transition-[translate,scale,opacity] ${slowly} ease-out ${
          drawing
            ? turned
              ? "-translate-x-1/2 -translate-y-[52%] scale-100 opacity-100"
              : "-translate-x-1/2 -translate-y-[38%] scale-[0.42] opacity-100"
            : "-translate-x-1/2 translate-y-[40%] scale-[0.3] opacity-0"
        }`}
      >
        <div
          className={`relative h-[62vh] w-[46vh] transition-transform ${
            reducedMotion ? "duration-0" : "duration-[900ms]"
          } ease-[cubic-bezier(0.2,0,0,1)] [transform-style:preserve-3d] ${
            turned ? "[transform:rotateY(180deg)]" : ""
          }`}
        >
          {/* Back */}
          <div
            aria-hidden
            className="absolute inset-0 rounded-[2.4vh] [backface-visibility:hidden] shadow-[inset_0_0_0_1px_rgb(242_214_138/0.55),inset_0_0_0_1.2vh_#15161a,inset_0_0_0_calc(1.2vh+1px)_rgb(242_214_138/0.25),0_4vh_8vh_rgb(0_0_0/0.6),0_0_8vh_rgb(242_214_138/0.12)]"
            style={{
              background:
                "repeating-linear-gradient(45deg, #15161a 0px, #15161a 1.1vh, #1c1d22 1.1vh, #1c1d22 1.2vh)",
            }}
          />
          {/* Face — only exists once turned, so the name is never in the DOM early. */}
          <div className="absolute inset-0 flex flex-col justify-between rounded-[2.4vh] bg-gradient-to-b from-[#1c1d22] to-[#121317] p-[5vh] [backface-visibility:hidden] [transform:rotateY(180deg)] shadow-[inset_0_0_0_1px_rgb(242_214_138/0.55),0_5vh_12vh_rgb(0_0_0/0.7),0_0_10vh_rgb(242_214_138/0.15)]">
            {turned && targetName ? (
              <>
                <span className="text-[min(1.8vh,1.15rem)] font-medium uppercase tracking-[0.14em] text-gold/80">
                  The winner is
                </span>
                <span
                  data-testid="reveal-winner"
                  className="text-[min(9vh,6rem)] leading-[1.02] font-semibold tracking-[-0.035em] text-gold-bright [text-shadow:0_0_6vh_rgb(242_214_138/0.3)]"
                >
                  {targetName}
                </span>
                <span className="flex items-center justify-between text-[min(1.9vh,1.2rem)] text-ink-500">
                  <span aria-hidden className="h-px w-[4vh] bg-gold/50" />1 card of {pool.length}
                </span>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
