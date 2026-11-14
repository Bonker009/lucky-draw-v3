"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Quality } from "@/lib/hooks/use-frame-budget";
import { planWall, roundEnds, type WallPlan } from "@/lib/stage/wall-plan";

/*
 * The name wall: every eligible name on screen at once, knocked out in halves
 * until the committed winner is the last one standing.
 *
 * It replaced the spinning reel because a reel shows five names out of
 * hundreds — nobody saw themselves, and nothing on screen said "everyone is
 * in this". The wall says it before the first sweep.
 *
 * Same contract the reel had, and for the same reasons:
 *
 * - It reveals, it never picks. `targetId` is the winner the engine already
 *   committed; `planWall` only decides the order everyone else fades in.
 * - The run is keyed on `targetId` alone. Quality, reduced motion, duration
 *   and the tick callback are read through refs, so a frame-budget downgrade
 *   or a settings patch mid-spin cannot restart the sweep.
 * - It never shows the answer early. The rounds before the last run on the
 *   wall's own clock and stop with two names standing; the final knock-out
 *   waits for `landed`, which the stage only sets once the engine has moved
 *   to `revealing`. However long suspense scaling stretches the spin, the
 *   wall cannot land before the engine does.
 *
 * Drawn on a canvas, not as DOM: a 500-name roster as elements was exactly
 * the v2 failure the "500 participants do not inflate the DOM" test exists to
 * catch. The only DOM text is the count, and the winner's name once landed.
 */

export interface WallEntry {
  id: string;
  name: string;
}

export interface NameWallProps {
  /** Everyone in the draw — the eligible roster, plus the target while it runs. */
  pool: WallEntry[];
  /** The committed winner being revealed, or null when idle. */
  targetId: string | null;
  /** True once the engine has revealed the target. Triggers the final round. */
  landed: boolean;
  durationMs: number;
  reducedMotion: boolean;
  quality: Quality;
  /** Fired as each round completes, for the tick sound. */
  onTick?: () => void;
}

/** A knocked-out name fades over this long once the sweep passes it. */
const FADE_MS = 360;
const FINAL_FADE_MS = 560;
/**
 * The rounds before the last finish by this share of the spin. The remainder
 * is a held beat with two names on screen — the moment the room is watching.
 */
const RUN_SHARE = 0.86;
const MIN_FONT = 11;
const MAX_FONT = 26;
/** Typical name length used to size columns; longer names are truncated. */
const TYPICAL_CHARS = 13;
const SWEEP_PX = 240;

const INK = "245 245 247";
const GOLD = "242 214 138";

interface Layout {
  mode: "names" | "dots";
  cols: number;
  cellW: number;
  cellH: number;
  font: number;
  offsetX: number;
  offsetY: number;
}

function computeLayout(n: number, w: number, h: number): Layout {
  if (n === 0 || w === 0 || h === 0) {
    return { mode: "names", cols: 1, cellW: w, cellH: 0, font: 0, offsetX: 0, offsetY: 0 };
  }
  let best: Layout | null = null;
  for (let cols = 2; cols <= 24; cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = w / cols;
    const cellH = h / rows;
    const font = Math.min(MAX_FONT, cellH * 0.6, (cellW - 16) / (TYPICAL_CHARS * 0.56));
    if (!best || font > best.font + 0.25) {
      best = { mode: "names", cols, cellW, cellH, font, offsetX: 0, offsetY: 0 };
    }
  }
  let layout = best!;
  if (layout.font < MIN_FONT) {
    // Too many to read as text: near-square cells, one dot per person.
    const cols = Math.max(1, Math.ceil(Math.sqrt((n * w) / h)));
    layout = { mode: "dots", cols, cellW: w / cols, cellH: h / Math.ceil(n / cols), font: 14, offsetX: 0, offsetY: 0 };
  } else {
    // Don't stretch a short roster's rows across the whole height.
    layout.cellH = Math.min(layout.cellH, layout.font * 1.9);
  }
  const rows = Math.ceil(n / layout.cols);
  layout.offsetY = Math.max(0, (h - rows * layout.cellH) / 2);
  return layout;
}

interface Run {
  targetId: string;
  pool: WallEntry[];
  plan: WallPlan;
  winner: number;
  t0: number;
  /** Start/end (ms from t0) of every round except the last. */
  starts: number[];
  ends: number[];
  landedAt: number | null;
  sweep: boolean;
  lastRound: number;
}

export function NameWall({
  pool,
  targetId,
  landed,
  durationMs,
  reducedMotion,
  quality,
  onTick,
}: NameWallProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const runRef = useRef<Run | null>(null);
  const rafRef = useRef<number | null>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const fitCache = useRef(new Map<string, string>());
  const fontFamily = useRef("sans-serif");

  // Everything a running sweep reads but must not restart on.
  const live = useRef({ pool, durationMs, reducedMotion, quality, onTick });
  useLayoutEffect(() => {
    live.current = { pool, durationMs, reducedMotion, quality, onTick };
  });

  const [hud, setHud] = useState({
    alive: pool.length,
    round: 0,
    rounds: 0,
    landed: false,
    total: pool.length,
    winnerName: null as string | null,
  });
  const hudRef = useRef(hud);

  const publish = (next: typeof hud) => {
    const prev = hudRef.current;
    if (
      prev.alive !== next.alive ||
      prev.round !== next.round ||
      prev.rounds !== next.rounds ||
      prev.landed !== next.landed ||
      prev.total !== next.total ||
      prev.winnerName !== next.winnerName
    ) {
      hudRef.current = next;
      setHud(next);
    }
  };

  function draw(now: number): boolean {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    const { w, h, dpr } = sizeRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const run = runRef.current;
    const entries = run ? run.pool : live.current.pool;
    const n = entries.length;
    if (n === 0 || w === 0) return false;
    const layout = computeLayout(n, w, h);

    const elapsed = run ? now - run.t0 : 0;
    const rounds = run ? run.plan.rounds : 0;

    // Which rounds are complete on the wall's own clock.
    let done = 0;
    if (run) {
      while (done < run.ends.length && elapsed >= run.ends[done]) done++;
      if (run.landedAt !== null && rounds > 0) done = rounds;
    }
    const aliveNow = run ? run.plan.aliveAfter[done] : n;

    if (run && done > run.lastRound) {
      run.lastRound = done;
      live.current.onTick?.();
    }
    publish({
      alive: aliveNow,
      round: run ? Math.min(done + 1, rounds) : 0,
      rounds,
      landed: run?.landedAt != null,
      total: n,
      // Only ever set once landed: the overlay is the one place the wall
      // puts a name into the DOM, and it must not exist before the reveal.
      winnerName: run && run.landedAt !== null ? entries[run.winner].name : null,
    });

    // The sweep band crossing the wall during the active round.
    const active = run && run.sweep && done < run.ends.length ? done : -1;
    let sweepX = -Infinity;
    if (run && active >= 0) {
      const span = run.ends[active] - run.starts[active];
      const p = Math.min(1, Math.max(0, (elapsed - run.starts[active]) / span));
      sweepX = p * (w + SWEEP_PX) - SWEEP_PX;
      const grad = ctx.createLinearGradient(sweepX, 0, sweepX + SWEEP_PX, 0);
      grad.addColorStop(0, `rgb(${INK} / 0)`);
      grad.addColorStop(0.85, `rgb(${INK} / 0.06)`);
      grad.addColorStop(1, `rgb(${INK} / 0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(sweepX, 0, SWEEP_PX, h);
      ctx.fillStyle = `rgb(${INK} / 0.22)`;
      ctx.fillRect(sweepX + SWEEP_PX - 1, 0, 1, h);
    }

    const fontPx = layout.mode === "names" ? Math.round(layout.font) : 14;
    ctx.textBaseline = "middle";
    const landedAt = run?.landedAt ?? null;
    const tiles = run !== null && aliveNow <= 64 && layout.mode === "names";
    const finalPair = run !== null && aliveNow <= 2 && landedAt === null;

    /** Opacity of entry i at this moment, and whether it still stands. */
    const stateOf = (i: number, cx: number): { a: number; standing: boolean; win: boolean } => {
      if (!run) return { a: 0.78, standing: true, win: false };
      const isWin = i === run.winner;
      if (isWin) return { a: 1, standing: true, win: landedAt !== null };
      const r = run.plan.outRound[i];
      let outAt: number;
      if (r === rounds) {
        if (landedAt === null) return { a: 1, standing: true, win: false };
        outAt = landedAt - run.t0;
      } else {
        const s = run.starts[r - 1];
        const e = run.ends[r - 1];
        outAt = run.sweep ? s + Math.min(1, (cx + SWEEP_PX * 0.15) / (w + SWEEP_PX)) * (e - s) : e;
      }
      if (elapsed < outAt) return { a: 1, standing: true, win: false };
      const fade = r === rounds ? FINAL_FADE_MS : FADE_MS;
      const t = Math.min(1, (elapsed - outAt) / fade);
      return { a: 1 - t * 0.93, standing: t < 1, win: false };
    };

    if (layout.mode === "names") {
      ctx.font = `500 ${fontPx}px ${fontFamily.current}`;
      for (let i = 0; i < n; i++) {
        const col = i % layout.cols;
        const row = Math.floor(i / layout.cols);
        const x = layout.offsetX + col * layout.cellW;
        const y = layout.offsetY + row * layout.cellH;
        const s = stateOf(i, x + layout.cellW / 2);
        const pad = 6;
        if (s.win || ((tiles || finalPair) && s.standing && s.a > 0.5)) {
          ctx.beginPath();
          ctx.roundRect(x + 4, y + 3, layout.cellW - 8, layout.cellH - 6, 6);
          ctx.fillStyle = s.win ? `rgb(${GOLD} / 0.14)` : `rgb(${INK} / ${finalPair ? 0.1 : 0.05})`;
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = s.win
            ? `rgb(${GOLD} / 0.6)`
            : `rgb(${INK} / ${finalPair ? 0.45 : 0.12})`;
          ctx.stroke();
        }
        const label = fit(ctx, entries[i].name, layout.cellW - pad * 2 - 8, fontPx);
        ctx.fillStyle = s.win
          ? `rgb(${GOLD})`
          : run
            ? `rgb(${INK} / ${s.a.toFixed(3)})`
            : `rgb(209 209 214 / ${s.a})`;
        ctx.fillText(label, x + pad + 4, y + layout.cellH / 2);
      }
    } else {
      const r = Math.max(1.5, Math.min(4, Math.min(layout.cellW, layout.cellH) * 0.18));
      const labels: [number, number, string, boolean][] = [];
      for (let i = 0; i < n; i++) {
        const col = i % layout.cols;
        const row = Math.floor(i / layout.cols);
        const cx = layout.offsetX + col * layout.cellW + layout.cellW / 2;
        const cy = layout.offsetY + row * layout.cellH + layout.cellH / 2;
        const s = stateOf(i, cx);
        ctx.beginPath();
        ctx.arc(cx, cy, s.win ? r * 2.2 : r, 0, Math.PI * 2);
        ctx.fillStyle = s.win ? `rgb(${GOLD})` : `rgb(${INK} / ${(run ? s.a : 0.5).toFixed(3)})`;
        ctx.fill();
        // Once few enough remain, the dots get their names back.
        if (run && aliveNow <= 40 && s.standing && s.a > 0.5) labels.push([cx, cy, entries[i].name, s.win]);
      }
      ctx.font = `500 15px ${fontFamily.current}`;
      for (const [cx, cy, name, win] of labels) {
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgb(6 6 7 / 0.85)";
        ctx.strokeText(name, cx + 8, cy);
        ctx.fillStyle = win ? `rgb(${GOLD})` : `rgb(${INK})`;
        ctx.fillText(name, cx + 8, cy);
      }
    }

    canvas.dataset.alive = String(aliveNow);

    // Keep animating while anything is still moving.
    if (!run) return false;
    if (landedAt === null) return true;
    return now - landedAt < FINAL_FADE_MS + 120;
  }

  function fit(ctx: CanvasRenderingContext2D, name: string, max: number, px: number): string {
    const key = `${px}|${max | 0}|${name}`;
    const cached = fitCache.current.get(key);
    if (cached !== undefined) return cached;
    let out = name;
    if (ctx.measureText(name).width > max) {
      let lo = 0;
      let hi = name.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ctx.measureText(name.slice(0, mid) + "…").width <= max) lo = mid;
        else hi = mid - 1;
      }
      out = name.slice(0, lo).trimEnd() + "…";
    }
    if (fitCache.current.size > 4000) fitCache.current.clear();
    fitCache.current.set(key, out);
    return out;
  }

  const kick = () => {
    if (rafRef.current !== null) return;
    const loop = (now: number) => {
      rafRef.current = null;
      if (draw(now)) rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  };

  // Size the canvas to its box, at device resolution.
  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    fontFamily.current = getComputedStyle(canvas).fontFamily || "sans-serif";
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { w: width, h: height, dpr };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      fitCache.current.clear();
      kick();
    });
    ro.observe(box);
    return () => {
      ro.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only
  }, []);

  // A new target starts a new run. Keyed on the target alone (see above).
  useEffect(() => {
    if (!targetId) {
      runRef.current = null;
      kick();
      return;
    }
    const { pool: entries, durationMs: d, reducedMotion: rm, quality: q } = live.current;
    const winner = entries.findIndex((e) => e.id === targetId);
    if (winner < 0) {
      runRef.current = null;
      kick();
      return;
    }
    const plan = planWall(entries.length, winner, targetId);
    const spin = (rm ? 600 : d) * RUN_SHARE;
    const ends = roundEnds(Math.max(0, plan.rounds - 1)).map((f) => f * spin);
    runRef.current = {
      targetId,
      pool: entries,
      plan,
      winner,
      t0: performance.now(),
      starts: [0, ...ends.slice(0, -1)],
      ends,
      landedAt: null,
      sweep: !rm && q !== "minimal",
      lastRound: 0,
    };
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the target only
  }, [targetId]);

  // The engine revealed the target: play the final round.
  useEffect(() => {
    const run = runRef.current;
    if (landed && run && run.landedAt === null) {
      run.landedAt = performance.now();
      kick();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kick is stable in effect
  }, [landed, targetId]);

  // Idle roster changes (an import, an undo) redraw the still wall.
  useEffect(() => {
    if (!runRef.current) kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kick is stable in effect
  }, [pool]);

  const winnerName = hud.winnerName;

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-[2.2vh]">
      <div
        role="status"
        className="flex h-[6vh] min-h-12 shrink-0 items-baseline gap-4"
      >
        <span
          className={`text-[min(5.2vh,3.5rem)] leading-none font-semibold tracking-tight tabular-nums ${
            hud.landed ? "text-gold-bright" : "text-ink-100"
          }`}
        >
          {hud.landed ? 1 : hud.alive}
        </span>
        <span className="text-[min(2.4vh,1.6rem)] text-ink-500">
          {hud.landed
            ? `winner, from ${hud.total} in the draw`
            : hud.rounds > 0
              ? "still in"
              : "in the draw"}
        </span>
        {hud.rounds > 0 && !hud.landed ? (
          <span className="ml-auto flex items-center gap-3 text-[min(1.8vh,1.15rem)] text-ink-500">
            Round{" "}
            <span className="text-ink-100 tabular-nums">
              {hud.round} of {hud.rounds}
            </span>
            <span aria-hidden className="flex gap-1.5">
              {Array.from({ length: hud.rounds }, (_, i) => (
                <span
                  key={i}
                  className={`h-[3px] w-[1.1vw] rounded-full ${
                    i + 1 < hud.round
                      ? "bg-ink-100"
                      : i + 1 === hud.round
                        ? "bg-gold-bright"
                        : "bg-ink-100/15"
                  }`}
                />
              ))}
            </span>
          </span>
        ) : null}
      </div>

      <div ref={boxRef} className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`${hud.total} names in the draw`}
          data-pool-size={hud.total}
          className="absolute inset-0 h-full w-full font-sans"
        />
        {winnerName ? (
          <div
            data-testid="reveal-winner"
            className="reveal-rise pointer-events-none absolute -inset-10 flex flex-col items-center justify-center gap-[2vh]"
            style={{
              background:
                "radial-gradient(ellipse 48% 34% at 50% 50%, rgb(6 6 7 / 0.94) 0%, rgb(6 6 7 / 0.7) 55%, transparent 85%)",
            }}
          >
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(ellipse 36% 20% at 50% 50%, rgb(242 214 138 / 0.16), transparent 75%)",
              }}
            />
            <span className="stage-name relative max-w-[90%] truncate text-center text-gold-bright">
              {winnerName}
            </span>
            <span className="relative flex items-center gap-4 text-[min(2.2vh,1.4rem)] text-ink-500">
              <span aria-hidden className="h-px w-10 bg-gold/50" />
              last name standing of {hud.total}
              <span aria-hidden className="h-px w-10 bg-gold/50" />
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
