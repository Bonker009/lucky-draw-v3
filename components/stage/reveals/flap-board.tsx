"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { RUN_SHARE, type RevealProps } from "./types";

/*
 * Split-flap board: the winner's name flips into place letter by letter, like
 * a departures board.
 *
 * Letters settle left to right over the run, and the last letter waits for
 * `landed` — so the room can start guessing, but the board is never complete
 * before the engine has revealed. Unsettled tiles churn through random
 * letters; that churn is written straight into the tile nodes from one rAF
 * loop, never through React state, so a 20-tile board costs nothing to
 * re-render and cannot be disturbed by anything else on the page.
 *
 * A split-flap only has Latin letters. A name in any other script (Khmer, most
 * often) flips as one wide panel instead, rolling through other names in the
 * draw until it lands — splitting a Khmer name into tiles would break its
 * clusters apart.
 */

const LATIN = /^[\p{Script=Latin}\p{N}\s.'’-]+$/u;
const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MIN_TILES = 12;
/** A flipping tile changes letter this often, roughly a real flap's cadence. */
const FLIP_MS = 70;

interface Run {
  targetId: string;
  chars: string[];
  /** ms from t0 at which each tile settles; Infinity = waits for landing. */
  settleAt: number[];
  t0: number;
  landedAt: number | null;
  settled: number;
  /** Other names for the whole-word panel to roll through. */
  decoys: string[];
}

export function FlapBoard({
  pool,
  targetId,
  landed,
  durationMs,
  reducedMotion,
  quality,
  onTick,
}: RevealProps) {
  const live = useRef({ pool, durationMs, reducedMotion, quality, onTick });
  useLayoutEffect(() => {
    live.current = { pool, durationMs, reducedMotion, quality, onTick };
  });

  const targetName = targetId
    ? (pool.find((p) => p.id === targetId)?.name ?? null)
    : null;
  const latin = targetName === null || LATIN.test(targetName);
  const display = (targetName ?? "").toLocaleUpperCase();
  const tileCount = Math.max(MIN_TILES, Array.from(display).length);

  const tileRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const panelRef = useRef<HTMLSpanElement>(null);
  const runRef = useRef<Run | null>(null);
  const rafRef = useRef<number | null>(null);

  const paint = (now: number): boolean => {
    const run = runRef.current;
    const tiles = tileRefs.current;
    if (!run) {
      tiles.forEach((t) => {
        if (t) {
          t.textContent = "";
          t.dataset.state = "idle";
        }
      });
      if (panelRef.current) panelRef.current.textContent = "";
      return false;
    }
    const elapsed = now - run.t0;
    const done = run.landedAt !== null;
    const frame = Math.floor(elapsed / FLIP_MS);
    const { reducedMotion: rm, quality: q } = live.current;
    const churn = !rm && q !== "minimal";

    if (!latin) {
      const panel = panelRef.current;
      if (panel) {
        if (done) {
          panel.textContent = targetName ?? "";
          panel.dataset.state = "set";
        } else if (churn && run.decoys.length > 0) {
          panel.textContent = run.decoys[Math.floor(elapsed / 140) % run.decoys.length];
          panel.dataset.state = "flip";
        } else {
          panel.textContent = "";
          panel.dataset.state = "idle";
        }
      }
      return !done;
    }

    let settled = 0;
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      if (!tile) continue;
      const ch = run.chars[i] ?? " ";
      const isSet = done || elapsed >= run.settleAt[i];
      if (isSet) {
        settled++;
        if (tile.textContent !== ch.trim()) tile.textContent = ch.trim();
        tile.dataset.state = ch.trim() ? "set" : "blank";
      } else if (churn) {
        // Per-tile offsets that share no factor with 26, so neighbouring tiles
        // never churn in lockstep.
        tile.textContent = CHARSET[(frame * (5 + (i % 3) * 2) + i * 11 + i * i) % CHARSET.length];
        tile.dataset.state = "flip";
      } else {
        tile.textContent = "";
        tile.dataset.state = "idle";
      }
    }
    if (settled > run.settled) {
      run.settled = settled;
      live.current.onTick?.();
    }
    return !done;
  };

  const kick = () => {
    if (rafRef.current !== null) return;
    const loop = (now: number) => {
      rafRef.current = null;
      if (paint(now)) rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  };

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    },
    [],
  );

  // A new target starts a run. Keyed on the target alone.
  useEffect(() => {
    if (!targetId || targetName === null) {
      runRef.current = null;
      kick();
      return;
    }
    const { pool: entries, durationMs: d } = live.current;
    const chars = Array.from(display);
    const pad = Math.floor((tileCount - chars.length) / 2);
    const padded = Array.from({ length: tileCount }, (_, i) => chars[i - pad] ?? " ");
    const letterIdx = padded.map((c, i) => (c.trim() ? i : -1)).filter((i) => i >= 0);
    const settleAt = padded.map(() => 0);
    letterIdx.forEach((tileIndex, j) => {
      settleAt[tileIndex] =
        j === letterIdx.length - 1
          ? Infinity
          : ((j + 1) / letterIdx.length) * d * RUN_SHARE;
    });
    runRef.current = {
      targetId,
      chars: padded,
      settleAt,
      t0: performance.now(),
      landedAt: null,
      settled: 0,
      decoys: entries
        .filter((e) => e.id !== targetId)
        .slice(0, 40)
        .map((e) => e.name),
    };
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the target only
  }, [targetId]);

  useEffect(() => {
    const run = runRef.current;
    if (landed && run && run.landedAt === null) {
      run.landedAt = performance.now();
      kick();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kick only schedules a frame
  }, [landed, targetId]);

  const status = !targetId ? "Ready" : landed ? "Winner" : "Flipping";
  const won = Boolean(targetId && landed);

  return (
    <div className="flex h-full min-h-0 w-full flex-col justify-center gap-[5vh]">
      <div className="flex items-center justify-between">
        <span className="text-[min(1.7vh,1.1rem)] font-medium uppercase tracking-[0.14em] text-ink-500">
          Now drawing
        </span>
        <span
          className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[min(1.5vh,1rem)] font-medium uppercase tracking-[0.08em] ${
            won ? "border-gold/40 text-gold-bright" : "border-ink-100/15 text-ink-300"
          }`}
        >
          <span
            aria-hidden
            className={`size-1.5 rounded-full ${won ? "bg-gold-bright" : "bg-ink-300"}`}
          />
          {status}
        </span>
      </div>

      {latin ? (
        <div
          aria-hidden
          data-landed={won}
          className="group mx-auto grid w-full gap-[0.35vw]"
          style={{
            gridTemplateColumns: `repeat(${tileCount}, minmax(0, 1fr))`,
            maxWidth: `${tileCount * 6.2}vw`,
          }}
        >
          {Array.from({ length: tileCount }, (_, i) => (
            <span
              key={`${targetId ?? "idle"}-${i}`}
              className="@container relative aspect-[0.68] overflow-hidden rounded-[0.5vw] bg-gradient-to-b from-[#1b1c21] to-[#121317] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05),0_0.6vh_1.6vh_rgb(0_0_0/0.45)]"
            >
              <span
                ref={(el) => {
                  tileRefs.current[i] = el;
                }}
                data-state="idle"
                className="absolute inset-0 flex items-center justify-center font-mono text-[78cqw] leading-none font-semibold text-ink-100 transition-[opacity,filter] duration-75 data-[state=flip]:opacity-70 data-[state=flip]:blur-[0.5px] group-data-[landed=true]:text-gold-bright group-data-[landed=true]:[text-shadow:0_0_2.4vw_rgb(242_214_138/0.4)]"
              />
              <span aria-hidden className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 bg-base-900" />
            </span>
          ))}
        </div>
      ) : (
        <div className="relative mx-auto flex h-[18vh] w-full max-w-[80vw] items-center justify-center overflow-hidden rounded-[1vw] bg-gradient-to-b from-[#1b1c21] to-[#121317] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05)]">
          <span
            ref={panelRef}
            aria-hidden
            data-state="idle"
            className={`name-mixed truncate px-[3vw] text-[min(9vh,6rem)] font-semibold data-[state=flip]:opacity-60 ${
              won ? "text-gold-bright" : "text-ink-100"
            }`}
          />
          <span aria-hidden className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 bg-base-900" />
        </div>
      )}

      <div
        aria-hidden
        className={`h-[2px] rounded-full ${
          won
            ? "bg-gradient-to-r from-gold-bright/70 to-transparent"
            : "bg-gradient-to-r from-ink-100/15 to-transparent"
        }`}
      />

      {won && targetName ? (
        <span data-testid="reveal-winner" className="sr-only">
          {targetName}
        </span>
      ) : null}
    </div>
  );
}
