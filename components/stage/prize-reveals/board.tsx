"use client";

import { useEffect, useState } from "react";
import { Gift } from "lucide-react";
import type { PrizeRevealProps } from "./types";

const LATIN = /^[\p{Script=Latin}\p{N}\s.'’&-]+$/u;
const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";
/** Tiles churn this often while covered or still settling. */
const FLIP_MS = 70;
/** One more tile lands every this often after the reveal, left to right. */
const SETTLE_MS = 110;
const SLATS = 8;

const glyph = (set: string, i: number, frame: number) =>
  set[(frame * (5 + (i % 3) * 2) + i * 11 + i * i) % set.length];

/*
 * C · Departures board.
 *
 * Covered: every tile churns, the status reads UP NEXT and the photo panel is
 * shut behind slats. Revealed: the name settles letter by letter, the count
 * and ON STAGE land, and the slats fold away top to bottom. The same tiles as
 * the split-flap draw style, so the two pair. A name in another script (Khmer,
 * often) cannot be split into tiles; it lands whole in a panel instead.
 */
export function BoardReveal({
  name,
  imageUrl,
  revealed,
  position,
  total,
  toWin,
  reducedMotion,
  quality,
}: PrizeRevealProps) {
  const still = reducedMotion || quality === "minimal";
  const display = name.toLocaleUpperCase();
  const latin = LATIN.test(display);
  const cols = Math.min(16, Math.max(10, Array.from(display).length));
  const chars = (() => {
    const c = latin ? Array.from(display).slice(0, cols) : [];
    const pad = Math.floor((cols - c.length) / 2);
    return Array.from({ length: cols }, (_, i) => c[i - pad] ?? " ");
  })();

  const [frame, setFrame] = useState(0);
  const [settled, setSettled] = useState(0);
  const done = revealed && (still || settled >= cols);

  // Churn while covered or settling; stop once every tile has landed.
  useEffect(() => {
    if (still || done) return;
    const id = setInterval(() => setFrame((f) => f + 1), FLIP_MS);
    return () => clearInterval(id);
  }, [still, done]);

  // Settle one tile at a time after the reveal. Never reset: the stage keys
  // this on the prize, and a reveal only ever goes covered → revealed.
  useEffect(() => {
    if (!revealed || still) return;
    const id = setInterval(() => setSettled((s) => s + 1), SETTLE_MS);
    return () => clearInterval(id);
  }, [revealed, still]);

  const shown = revealed ? (still ? cols : settled) : 0;
  const qty = String(Math.min(99, toWin)).padStart(2, "0");
  const status = (revealed && done ? "ON STAGE" : "UP NEXT ").split("");

  return (
    <div className="flex h-full w-full flex-col gap-[4vh] px-[6vw] pb-[8vh] pt-[8vh]">
      <div className="flex flex-col gap-[1.6vh]">
        <div className="flex gap-[3vw] text-[clamp(0.75rem,1.6vh,1.1rem)] font-medium uppercase tracking-[0.14em] text-ink-500">
          <span className="flex-1">Next prize · {position} of {total}</span>
          <span className="w-[9vw]">To win</span>
          <span className="w-[22vw]">Status</span>
        </div>
        <div className="flex items-center gap-[3vw]">
          <div
            role="img"
            aria-label={revealed ? name : "Prize name still flipping"}
            className="grid flex-1 gap-[0.35vw]"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {chars.map((ch, i) => {
              const set = i < shown;
              const letter = set ? ch.trim() : still ? "" : glyph(CHARSET, i, frame);
              return (
                <Tile key={i} big settled={set} churning={!set && !still}>
                  {letter}
                </Tile>
              );
            })}
          </div>
          <div className="grid w-[9vw] grid-cols-2 gap-[0.35vw]" aria-label={`${toWin} to win`} role="img">
            {qty.split("").map((d, i) => (
              <Tile key={i} big settled={done} churning={!done && !still}>
                {done ? d : still ? "" : glyph(DIGITS, i + 3, frame)}
              </Tile>
            ))}
          </div>
          <div className="flex w-[22vw] gap-[0.25vw]" aria-label={status.join("").trim()} role="img">
            {status.map((c, i) => (
              <Tile key={i} settled={done}>
                {c.trim()}
              </Tile>
            ))}
          </div>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[1.2vw] bg-[#0b0c0e] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06),0_3vh_8vh_rgb(0_0_0/0.55)]">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob: URL from IndexedDB
          <img src={imageUrl} alt="" className="absolute inset-0 size-full object-cover" />
        ) : (
          <div className="absolute inset-0 grid place-items-center">
            <Gift aria-hidden strokeWidth={1} className="size-[16vh] text-ink-100/60" />
          </div>
        )}
        {!latin && done ? (
          <div className="absolute inset-0 grid place-items-center bg-[rgb(6_6_7/0.55)]">
            <span className="name-mixed px-[3vw] text-center text-[clamp(2rem,8vh,6rem)] font-semibold text-ink-100">
              {name}
            </span>
          </div>
        ) : null}
        <div aria-hidden className="absolute inset-0 grid [perspective:1400px]" style={{ gridTemplateRows: `repeat(${SLATS}, minmax(0, 1fr))` }}>
          {Array.from({ length: SLATS }, (_, i) => (
            <div
              key={i}
              className="origin-top bg-[linear-gradient(180deg,#1b1c21,#111216)] shadow-[inset_0_-1px_0_#050506,inset_0_1px_0_rgb(255_255_255/0.04)]"
              style={{
                transform: `rotateX(${done ? -90 : 0}deg)`,
                transition: still ? "none" : "transform 520ms cubic-bezier(0.6,0,0.3,1)",
                transitionDelay: still ? "0ms" : `${done ? 150 + i * 70 : (SLATS - 1 - i) * 40}ms`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Tile({
  children,
  big = false,
  settled,
  churning = false,
}: {
  children: string;
  big?: boolean;
  settled: boolean;
  churning?: boolean;
}) {
  return (
    // The tile is the size container and the glyph is a child of it: a cqw
    // unit resolves against the nearest *ancestor* container, so text sized on
    // the container element itself came out the width of the whole stage.
    <span
      aria-hidden
      className={`@container relative overflow-hidden rounded-[0.4vw] bg-[linear-gradient(180deg,#1b1c21,#121317)] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05),0_0.6vh_1.6vh_rgb(0_0_0/0.45)] ${
        big ? "aspect-[0.68]" : "aspect-[0.68] flex-1"
      }`}
    >
      <span
        className={`absolute inset-0 flex items-center justify-center font-mono font-semibold leading-none ${
          big ? "text-[78cqw]" : "text-[70cqw]"
        } ${settled ? "text-ink-100 [text-shadow:0_0_2vw_rgb(255_255_255/0.22)]" : churning ? "text-ink-100/45 blur-[0.4px]" : "text-ink-300"}`}
      >
        {children}
      </span>
      <span className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 bg-[#06070b]" />
    </span>
  );
}
