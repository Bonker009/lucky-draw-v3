"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Quality } from "@/lib/hooks/use-frame-budget";
import { canvasMeasure, fitFontSize, type Measure } from "@/lib/stage/fit-text";
import { planWall, roundEnds, type WallPlan } from "@/lib/stage/wall-plan";
import { useFittedSize } from "@/components/stage/reveals/use-fitted-size";

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
 * The finale gathers. Once `GATHER` or fewer are left, the survivors glide out
 * of the wall into a centred layout of large cards, and later rounds knock
 * cards out of that. Left where they were, the last eight were small tiles
 * scattered across a dim wall — the part of the draw the room most wants to
 * read was the hardest to read from the back.
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

/** A knocked-out name fades (and drops) over this long once the sweep passes it. */
const FADE_MS = 420;
const FINAL_FADE_MS = 620;
/** How far a knocked-out name drops as it fades, in px. */
const DROP_PX = 10;
/**
 * The rounds before the last finish by this share of the spin. The remainder
 * is a held beat with two names on screen — the moment the room is watching.
 */
const RUN_SHARE = 0.86;
/** At or below this many standing, the survivors gather into large cards. */
const GATHER = 16;
const GATHER_MS = 780;
/** Gathered cards knocked out in one round fall one after another, this far apart. */
const CARD_STAGGER_MS = 70;
const MIN_FONT = 11;
const MAX_FONT = 26;
/** Typical name length used to size columns; longer names are truncated. */
const TYPICAL_CHARS = 13;
const SWEEP_PX = 260;
/** Idle shimmer redraw interval — a slow glint, not 60fps of work while waiting. */
const SHIMMER_MS = 50;

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

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
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

/** Centred card slots for `n` gathered survivors. */
function gatherSlots(n: number, w: number, h: number): Rect[] {
  if (n === 0) return [];
  const cols = n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 2 : 4;
  const rows = Math.ceil(n / cols);
  const gap = Math.max(12, w * 0.014);
  const cardW = Math.min((w * 0.86 - gap * (cols - 1)) / cols, n <= 2 ? w * 0.4 : w * 0.3);
  const cardH = Math.min(cardW * (n <= 2 ? 0.34 : 0.3), (h * 0.74 - gap * (rows - 1)) / rows);
  const gridW = cols * cardW + gap * (cols - 1);
  const gridH = rows * cardH + gap * (rows - 1);
  const x0 = (w - gridW) / 2;
  const y0 = (h - gridH) / 2;
  return Array.from({ length: n }, (_, k) => {
    const row = Math.floor(k / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols;
    // Centre a short last row.
    const rowX = x0 + ((cols - inRow) * (cardW + gap)) / 2;
    return { x: rowX + (k % cols) * (cardW + gap), y: y0 + row * (cardH + gap), w: cardW, h: cardH };
  });
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Gather {
  /** Round count (or "landed") this layout belongs to. */
  key: string;
  t0: number;
  from: Map<number, Rect>;
  to: Map<number, Rect>;
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
  gather: Gather | null;
  /** Where each gathered card was last drawn, so a re-gather starts from there. */
  lastRect: Map<number, Rect>;
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
  const cardFit = useRef(new Map<string, number>());
  const fontFamily = useRef("sans-serif");
  const measureRef = useRef<Measure | null>(null);
  const lastShimmer = useRef(0);

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

  /** Single-line size for a name on a gathered card, cached per name and width. */
  const cardFont = (name: string, rect: Rect) => {
    const key = `${name}|${Math.round(rect.w)}|${Math.round(rect.h)}`;
    const hit = cardFit.current.get(key);
    if (hit !== undefined) return hit;
    if (!measureRef.current) measureRef.current = canvasMeasure(600, fontFamily.current);
    const px = fitFontSize(name, {
      maxWidth: rect.w * 0.86,
      maxLines: 1,
      max: rect.h * 0.42,
      min: Math.max(12, rect.h * 0.16),
      measure: measureRef.current,
    });
    cardFit.current.set(key, px);
    return px;
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
    const { reducedMotion: rm, quality: q } = live.current;

    const elapsed = run ? now - run.t0 : 0;
    const rounds = run ? run.plan.rounds : 0;
    const landedAt = run?.landedAt ?? null;

    // Which rounds are complete on the wall's own clock.
    let done = 0;
    if (run) {
      while (done < run.ends.length && elapsed >= run.ends[done]) done++;
      if (landedAt !== null && rounds > 0) done = rounds;
    }
    if (run && done > run.lastRound) {
      run.lastRound = done;
      live.current.onTick?.();
    }

    /** When entry i is knocked out (ms from t0), or Infinity if it is not. */
    const outAt = (i: number, cx: number): number => {
      if (!run || i === run.winner) return Infinity;
      const r = run.plan.outRound[i];
      if (r === rounds) return landedAt === null ? Infinity : landedAt - run.t0;
      const s = run.starts[r - 1];
      const e = run.ends[r - 1];
      // Rounds played in the gathered layout end all at once (staggered per
      // card below); wall rounds follow the sweep across the screen.
      const gathered = run.plan.aliveAfter[r - 1] <= GATHER;
      if (gathered || !run.sweep) return e;
      return s + Math.min(1, (cx + SWEEP_PX * 0.15) / (w + SWEEP_PX)) * (e - s);
    };

    // The count ticks down name by name as the sweep passes, not once a round.
    let standingCount = 0;
    const wallCx = (i: number) => layout.offsetX + (i % layout.cols) * layout.cellW + layout.cellW / 2;
    if (run) {
      for (let i = 0; i < n; i++) if (elapsed < outAt(i, wallCx(i))) standingCount++;
    } else {
      standingCount = n;
    }

    // ---- Gathering -------------------------------------------------------
    // Survivors of the completed rounds, once few enough to gather.
    const aliveAfterDone = run ? run.plan.aliveAfter[done] : n;
    const gatherOn = run !== null && aliveAfterDone <= GATHER;
    if (run && gatherOn) {
      const key = landedAt !== null ? "landed" : String(done);
      if (!run.gather || run.gather.key !== key) {
        const survivors: number[] = [];
        for (let i = 0; i < n; i++) {
          if (i === run.winner || run.plan.outRound[i] > done) survivors.push(i);
        }
        if (landedAt !== null) survivors.splice(0, survivors.length, run.winner);
        const slots = gatherSlots(survivors.length, w, h);
        const to = new Map<number, Rect>();
        const from = new Map<number, Rect>();
        survivors.forEach((i, k) => {
          to.set(i, slots[k]);
          const prev = run.lastRect.get(i);
          from.set(
            i,
            prev ?? {
              x: layout.offsetX + (i % layout.cols) * layout.cellW,
              y: layout.offsetY + Math.floor(i / layout.cols) * layout.cellH,
              w: layout.cellW,
              h: layout.cellH,
            },
          );
        });
        run.gather = { key, t0: now, from, to };
      }
    }

    // ---- Sweep band ------------------------------------------------------
    const active = run && run.sweep && done < run.ends.length && run.plan.aliveAfter[done] > GATHER ? done : -1;
    if (run && active >= 0) {
      const span = run.ends[active] - run.starts[active];
      const p = Math.min(1, Math.max(0, (elapsed - run.starts[active]) / span));
      const sweepX = p * (w + SWEEP_PX) - SWEEP_PX;
      const grad = ctx.createLinearGradient(sweepX, 0, sweepX + SWEEP_PX, 0);
      grad.addColorStop(0, `rgb(${INK} / 0)`);
      grad.addColorStop(0.8, `rgb(${INK} / 0.05)`);
      grad.addColorStop(1, `rgb(${INK} / 0.13)`);
      ctx.fillStyle = grad;
      ctx.fillRect(sweepX, 0, SWEEP_PX, h);
      // A bright leading edge with a soft halo, so the room can follow it.
      const edge = sweepX + SWEEP_PX;
      const halo = ctx.createLinearGradient(edge - 18, 0, edge + 18, 0);
      halo.addColorStop(0, `rgb(${INK} / 0)`);
      halo.addColorStop(0.5, `rgb(${INK} / 0.22)`);
      halo.addColorStop(1, `rgb(${INK} / 0)`);
      ctx.fillStyle = halo;
      ctx.fillRect(edge - 18, 0, 36, h);
      ctx.fillStyle = `rgb(${INK} / 0.55)`;
      ctx.fillRect(edge - 1, 0, 2, h);
    }

    // ---- The wall --------------------------------------------------------
    const fontPx = layout.mode === "names" ? Math.round(layout.font) : 14;
    ctx.textBaseline = "middle";
    const tiles = run !== null && !gatherOn && standingCount <= 64 && layout.mode === "names";
    const shimmer = !run && !rm && q === "full";

    /** Opacity of a wall entry, its drop in px, and whether it still stands. */
    const wallState = (i: number, cx: number) => {
      if (!run) {
        const a = shimmer ? 0.72 + 0.2 * Math.max(0, Math.sin(now / 900 + i * 2.39)) ** 6 : 0.78;
        return { a, drop: 0, standing: true };
      }
      const o = outAt(i, cx);
      if (elapsed < o) return { a: 1, drop: 0, standing: true };
      const fade = run.plan.outRound[i] === rounds ? FINAL_FADE_MS : FADE_MS;
      const t = Math.min(1, (elapsed - o) / fade);
      return { a: 1 - ease(t) * 0.94, drop: rm ? 0 : ease(t) * DROP_PX, standing: false };
    };

    if (layout.mode === "names") {
      ctx.font = `500 ${fontPx}px ${fontFamily.current}`;
      for (let i = 0; i < n; i++) {
        const col = i % layout.cols;
        const row = Math.floor(i / layout.cols);
        const x = layout.offsetX + col * layout.cellW;
        const y = layout.offsetY + row * layout.cellH;
        const s = wallState(i, x + layout.cellW / 2);
        // Gathered survivors leave the wall; only their dim ghost stays.
        const isGathered = gatherOn && run!.gather!.to.has(i);
        const alpha = isGathered ? 0.06 : gatherOn ? Math.min(s.a, 0.06) : s.a;
        if (tiles && s.standing) {
          ctx.beginPath();
          ctx.roundRect(x + 4, y + 3, layout.cellW - 8, layout.cellH - 6, 6);
          ctx.fillStyle = `rgb(${INK} / 0.05)`;
          ctx.fill();
          ctx.lineWidth = 1;
          ctx.strokeStyle = `rgb(${INK} / 0.12)`;
          ctx.stroke();
        }
        const label = fit(ctx, entries[i].name, layout.cellW - 20, fontPx);
        ctx.fillStyle = run ? `rgb(${INK} / ${alpha.toFixed(3)})` : `rgb(209 209 214 / ${alpha.toFixed(3)})`;
        ctx.fillText(label, x + 10, y + layout.cellH / 2 + s.drop);
      }
    } else {
      const r = Math.max(1.5, Math.min(4, Math.min(layout.cellW, layout.cellH) * 0.18));
      for (let i = 0; i < n; i++) {
        const col = i % layout.cols;
        const row = Math.floor(i / layout.cols);
        const cx = layout.offsetX + col * layout.cellW + layout.cellW / 2;
        const cy = layout.offsetY + row * layout.cellH + layout.cellH / 2;
        const s = wallState(i, cx);
        const isGathered = gatherOn && run!.gather!.to.has(i);
        const alpha = run ? (isGathered ? 0.08 : gatherOn ? Math.min(s.a, 0.08) : s.a) : s.a * 0.65;
        ctx.beginPath();
        ctx.arc(cx, cy + s.drop, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(${INK} / ${alpha.toFixed(3)})`;
        ctx.fill();
      }
    }

    // ---- The gathered cards ---------------------------------------------
    let moving = false;
    if (run && gatherOn && run.gather) {
      // Darken the wall behind the cards so they own the frame.
      const scrim = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.6);
      scrim.addColorStop(0, "rgb(6 6 7 / 0.78)");
      scrim.addColorStop(1, "rgb(6 6 7 / 0.35)");
      ctx.fillStyle = scrim;
      ctx.fillRect(0, 0, w, h);

      const g = run.gather;
      const k = rm ? 1 : Math.min(1, (now - g.t0) / GATHER_MS);
      if (k < 1) moving = true;
      const e = ease(k);

      // Cards knocked out of the gathered layout fall away where they were.
      const leaving: number[] = [];
      run.lastRect.forEach((_, i) => {
        if (!g.to.has(i)) leaving.push(i);
      });
      leaving.forEach((i, order) => {
        const rect = run.lastRect.get(i)!;
        const o = (landedAt !== null && run.plan.outRound[i] === rounds ? landedAt - run.t0 : outAt(i, 0)) + order * CARD_STAGGER_MS;
        const t = Math.min(1, Math.max(0, (elapsed - o) / FADE_MS));
        if (t >= 1) {
          run.lastRect.delete(i);
          return;
        }
        moving = true;
        drawCard(ctx, entries[i].name, { ...rect, y: rect.y + (rm ? 0 : ease(t) * DROP_PX * 2) }, 1 - ease(t), "out");
      });

      g.to.forEach((to, i) => {
        const from = g.from.get(i)!;
        const rect: Rect = {
          x: lerp(from.x, to.x, e),
          y: lerp(from.y, to.y, e),
          w: lerp(from.w, to.w, e),
          h: lerp(from.h, to.h, e),
        };
        if (k >= 1) run.lastRect.set(i, to);
        else run.lastRect.set(i, rect);
        const finalPair = g.to.size <= 2 && landedAt === null;
        const won = landedAt !== null && i === run.winner;
        drawCard(ctx, entries[i].name, rect, Math.min(1, 0.35 + e), won ? "win" : finalPair ? "pair" : "in");
      });
    }

    canvas.dataset.alive = String(landedAt !== null ? 1 : standingCount);
    publish({
      alive: standingCount,
      round: run ? Math.min(done + 1, rounds) : 0,
      rounds,
      landed: landedAt !== null,
      total: n,
      // Only ever set once landed: the overlay is the one place the wall
      // puts a name into the DOM, and it must not exist before the reveal.
      winnerName: run && landedAt !== null ? entries[run.winner].name : null,
    });

    if (!run) return shimmer;
    if (landedAt === null || moving) return true;
    return now - landedAt < FINAL_FADE_MS + GATHER_MS + 200;
  }

  function drawCard(
    ctx: CanvasRenderingContext2D,
    name: string,
    rect: Rect,
    alpha: number,
    kind: "in" | "pair" | "win" | "out",
  ) {
    const radius = Math.min(14, rect.h * 0.22);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, radius);
    ctx.fillStyle =
      kind === "win" ? `rgb(${GOLD} / 0.14)` : kind === "pair" ? "rgb(32 33 38 / 0.96)" : "rgb(24 25 29 / 0.94)";
    ctx.fill();
    ctx.lineWidth = kind === "pair" || kind === "win" ? 1.5 : 1;
    ctx.strokeStyle =
      kind === "win" ? `rgb(${GOLD} / 0.7)` : kind === "pair" ? `rgb(${INK} / 0.5)` : `rgb(${INK} / 0.14)`;
    ctx.stroke();
    const px = cardFont(name, rect);
    ctx.font = `600 ${px}px ${fontFamily.current}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = kind === "win" ? `rgb(${GOLD})` : `rgb(${INK})`;
    ctx.fillText(name, rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.restore();
    ctx.textAlign = "start";
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
      // The idle shimmer only needs a slow glint; skip frames between beats.
      if (!runRef.current && now - lastShimmer.current < SHIMMER_MS) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      lastShimmer.current = now;
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
    measureRef.current = null;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { w: width, h: height, dpr };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      fitCache.current.clear();
      cardFit.current.clear();
      // A resize moves every slot; restart any gather from where cards are.
      if (runRef.current) runRef.current.gather = null;
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
      gather: null,
      lastRect: new Map(),
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

  // Idle roster changes (an import, an undo) redraw the still wall, and a
  // quality or motion change starts or stops the shimmer.
  useEffect(() => {
    if (!runRef.current) kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kick is stable in effect
  }, [pool, quality, reducedMotion]);

  const winnerName = hud.winnerName;
  // The winner's name wraps to two lines and shrinks to fit rather than being
  // cut off with an ellipsis — a truncated winner is a name nobody can read.
  const [winnerBox, winnerPx] = useFittedSize(winnerName, { maxLines: 2, maxVh: 15, maxPx: 144, minPx: 36, weight: 700 });

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
              ? hud.alive === 2
                ? "left — one more round"
                : "still in"
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
                // Wide and tall enough for a name that wraps to two lines,
                // so the wall (and the winner's own gold card) never shows
                // through behind the overlay.
                "radial-gradient(ellipse 64% 48% at 50% 50%, rgb(6 6 7 / 0.96) 0%, rgb(6 6 7 / 0.82) 55%, transparent 88%)",
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
            <div ref={winnerBox} className="relative w-[90%]">
              <span
                className="stage-name name-mixed block text-center text-gold-bright [overflow-wrap:anywhere] [text-wrap:balance]"
                style={winnerPx ? { fontSize: winnerPx, lineHeight: 1.05 } : undefined}
              >
                {winnerName}
              </span>
            </div>
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
