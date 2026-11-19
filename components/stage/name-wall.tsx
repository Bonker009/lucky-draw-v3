"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Quality } from "@/lib/hooks/use-frame-budget";
import { canvasMeasure, fitFontSize, type Measure } from "@/lib/stage/fit-text";
import { WALL_SPOTLIGHT_MAX, planWall, roundEnds, type WallPlan } from "@/lib/stage/wall-plan";
import { useFittedSize } from "@/components/stage/reveals/use-fitted-size";
import { SparklesText } from "@/components/ui/sparkles-text";
import { TextAnimate } from "@/components/ui/text-animate";

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
 * A multi-winner draw is one run towards all of them ("last 3 standing"):
 * `targetIds` holds the whole batch, the final round takes the field to
 * exactly that many cards, and as the engine reveals each winner in turn
 * (`revealedIds` grows by one) that card is spotlit — lifted and turned gold —
 * and stays gold. The names go into the DOM only as they are revealed.
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
  /**
   * The whole batch when several winners are revealed in one run, in commit
   * order. Defaults to `[targetId]`. The run is keyed on this list.
   */
  targetIds?: string[];
  /** Winners of this run the engine has revealed so far, in order. */
  revealedIds?: string[];
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
/** How long a spotlit card takes to lift. */
const SPOTLIGHT_MS = 420;
const SPOTLIGHT_SCALE = 1.1;
/** Gathered cards knocked out in one round fall one after another, this far apart. */
const CARD_STAGGER_MS = 70;
const MIN_FONT = 11;
const MAX_FONT = 26;
/** Typical name length used to size columns; longer names are truncated. */
const TYPICAL_CHARS = 13;
const SWEEP_PX = 260;
/** Blocks this close behind the sweep's leading edge are still lit by it. */
const SWEEP_GLOW_PX = 170;
/** Idle shimmer redraw interval — a slow glint, not 60fps of work while waiting. */
const SHIMMER_MS = 33;
/** The idle sheen crosses the wall once per period, in this share of it. */
const SHEEN_PERIOD_MS = 7000;
const SHEEN_SHARE = 0.55;
const SHEEN_PX = 210;
/** One lap of the border beam around a face-off card. */
const BEAM_MS = 2600;

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
    // Each name sits in a block with its own padding, so the text gets a
    // little less of the cell than it did as bare text.
    const font = Math.min(MAX_FONT, cellH * 0.58, (cellW - 22) / (TYPICAL_CHARS * 0.56));
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
    layout.cellH = Math.min(layout.cellH, layout.font * 2.3);
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
  key: string;
  pool: WallEntry[];
  plan: WallPlan;
  /** Pool indices of the winners, in commit (= reveal) order. */
  winners: number[];
  winnerSet: Set<number>;
  /** Winners the engine has revealed so far. */
  revealed: Set<number>;
  /** The card currently lifted, and since when. */
  spotlight: { index: number; at: number } | null;
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
  targetIds,
  revealedIds,
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
  /** Per-entry (left, drop, glow) for the frame being drawn; reused, never reallocated per frame. */
  const stateBuf = useRef(new Float32Array(0));

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
    winners: 1,
    finalNext: false,
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
      prev.winners !== next.winners ||
      prev.finalNext !== next.finalNext ||
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
      if (!run || run.winnerSet.has(i)) return Infinity;
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
          if (run.winnerSet.has(i) || run.plan.outRound[i] > done) survivors.push(i);
        }
        // Landed: the winners' cards, in the order they will be revealed.
        if (landedAt !== null) survivors.splice(0, survivors.length, ...run.winners);
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
    /** x of the sweep's leading edge, so blocks it has just passed can flash. */
    let sweepEdge: number | null = null;
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
      sweepEdge = edge;
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
    const shimmer = !run && !rm && q === "full";

    /**
     * A wall entry: `k` is how much of it is left (1 standing, 0 gone), `a`
     * the matching opacity for the dot wall, and `drop` its fall in px.
     */
    const wallState = (i: number, cx: number) => {
      if (!run) return { a: 0.78, k: 1, drop: 0, standing: true };
      const o = outAt(i, cx);
      if (elapsed < o) return { a: 1, k: 1, drop: 0, standing: true };
      const fade = run.plan.outRound[i] === rounds ? FINAL_FADE_MS : FADE_MS;
      const t = Math.min(1, (elapsed - o) / fade);
      return { a: 1 - ease(t) * 0.94, k: 1 - ease(t), drop: rm ? 0 : ease(t) * DROP_PX, standing: false };
    };

    if (layout.mode === "names") {
      // Every name is a block: a small card with a hairline border and a lit
      // top edge, the way a shadcn badge reads. They are painted here rather
      // than mounted as components — one element per name is the v2 failure —
      // and batched into three paths, so 500 blocks cost three fills a frame,
      // not a thousand.
      const gx = Math.max(2, Math.min(6, layout.cellW * 0.035));
      const gy = Math.max(1.5, Math.min(5, layout.cellH * 0.07));
      const cw = layout.cellW - gx * 2;
      const ch = layout.cellH - gy * 2;
      const radius = Math.min(9, ch * 0.3);
      const flat = q === "minimal";

      // The idle sheen: one slow diagonal glint across the blocks, then a rest.
      const sheenPhase = (now % SHEEN_PERIOD_MS) / (SHEEN_PERIOD_MS * SHEEN_SHARE);
      const sheenAt =
        shimmer && sheenPhase < 1 ? sheenPhase * (w + h * 0.6 + SHEEN_PX * 2) - SHEEN_PX : null;

      if (stateBuf.current.length < n * 3) stateBuf.current = new Float32Array(n * 3);
      const buf = stateBuf.current;
      const standingPath = new Path2D();
      const lipPath = new Path2D();
      const ghostPath = new Path2D();

      for (let i = 0; i < n; i++) {
        const x = layout.offsetX + (i % layout.cols) * layout.cellW;
        const y = layout.offsetY + Math.floor(i / layout.cols) * layout.cellH;
        const cx = x + layout.cellW / 2;
        const s = wallState(i, cx);
        // Gathered survivors leave the wall as cards; only their slot stays.
        // That includes a card being knocked out: it fades as a card, and
        // must not also fade as a block back in its old slot.
        const k = gatherOn && (s.standing || run!.lastRect.has(i)) ? 0 : s.k;
        let glow = 0;
        if (sheenAt !== null) {
          glow = Math.max(0, 1 - Math.abs(cx + y * 0.6 - sheenAt) / SHEEN_PX) ** 2;
        } else if (s.standing && sweepEdge !== null) {
          // Survivors flash as the sweep clears them: "still in".
          const d = sweepEdge - cx;
          if (d >= 0 && d < SWEEP_GLOW_PX) glow = (1 - d / SWEEP_GLOW_PX) ** 2;
        }
        buf[i * 3] = k;
        buf[i * 3 + 1] = s.drop;
        buf[i * 3 + 2] = glow;
        if (k >= 1) {
          standingPath.roundRect(x + gx, y + gy, cw, ch, radius);
          if (!flat) lipPath.rect(x + gx + radius, y + gy + 0.5, cw - radius * 2, 1);
        } else {
          // An empty slot stays where the name was, so the wall keeps its
          // shape as it thins out instead of collapsing into scattered text.
          ghostPath.roundRect(x + gx, y + gy, cw, ch, radius);
        }
      }

      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgb(${INK} / 0.05)`;
      ctx.stroke(ghostPath);
      // Navy under the tint: an uploaded background is a busy photo, and a
      // block has to win against it for the name to be readable.
      ctx.fillStyle = `rgb(14 18 44 / ${run ? 0.6 : 0.5})`;
      ctx.fill(standingPath);
      ctx.fillStyle = `rgb(${INK} / ${run ? 0.07 : 0.05})`;
      ctx.fill(standingPath);
      ctx.strokeStyle = `rgb(${INK} / ${run ? 0.17 : 0.13})`;
      ctx.stroke(standingPath);
      ctx.fillStyle = `rgb(${INK} / 0.09)`;
      ctx.fill(lipPath);

      ctx.font = `500 ${fontPx}px ${fontFamily.current}`;
      ctx.textAlign = "center";
      const landedOnWall = run !== null && landedAt !== null && !gatherOn;
      const baseText = run ? 0.94 : 0.82;
      for (let i = 0; i < n; i++) {
        const k = buf[i * 3];
        const drop = buf[i * 3 + 1];
        const glow = buf[i * 3 + 2];
        const x = layout.offsetX + (i % layout.cols) * layout.cellW;
        const y = layout.offsetY + Math.floor(i / layout.cols) * layout.cellH;
        const label = fit(ctx, entries[i].name, cw - 14, fontPx);
        const tx = x + layout.cellW / 2;
        const ty = y + layout.cellH / 2;
        // A batch too big to gather lands on the wall itself: revealed
        // winners turn gold in place.
        if (landedOnWall && run!.revealed.has(i)) {
          ctx.beginPath();
          ctx.roundRect(x + gx, y + gy, cw, ch, radius);
          ctx.fillStyle = `rgb(${GOLD} / 0.12)`;
          ctx.fill();
          ctx.strokeStyle = `rgb(${GOLD} / 0.75)`;
          ctx.stroke();
          ctx.fillStyle = `rgb(${GOLD})`;
          ctx.fillText(label, tx, ty);
          continue;
        }
        if (k >= 1) {
          if (glow > 0.03) {
            ctx.beginPath();
            ctx.roundRect(x + gx, y + gy, cw, ch, radius);
            ctx.fillStyle = `rgb(${INK} / ${(glow * 0.1).toFixed(3)})`;
            ctx.fill();
            ctx.strokeStyle = `rgb(${INK} / ${(glow * 0.5).toFixed(3)})`;
            ctx.stroke();
          }
          ctx.fillStyle = `rgb(${INK} / ${Math.min(1, baseText + glow * 0.18).toFixed(3)})`;
          ctx.fillText(label, tx, ty);
        } else if (k > 0.004) {
          // Knocked out: the block falls out of its slot as it fades.
          ctx.beginPath();
          ctx.roundRect(x + gx, y + gy + drop, cw, ch, radius);
          ctx.fillStyle = `rgb(14 18 44 / ${(k * 0.6).toFixed(3)})`;
          ctx.fill();
          ctx.strokeStyle = `rgb(${INK} / ${(k * 0.17).toFixed(3)})`;
          ctx.stroke();
          ctx.fillStyle = `rgb(${INK} / ${Math.max(0.07, k * 0.94).toFixed(3)})`;
          ctx.fillText(label, tx, ty + drop);
        } else {
          ctx.fillStyle = `rgb(${INK} / 0.07)`;
          ctx.fillText(label, tx, ty);
        }
      }
      ctx.textAlign = "start";
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
      // Darken the wall behind the cards so they own the frame. It fades to
      // nothing before the canvas edge: ending at 0.35 drew the canvas as a
      // hard-edged dark box once the stage background stopped being black.
      const scrim = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.6);
      scrim.addColorStop(0, "rgb(14 18 44 / 0.8)");
      scrim.addColorStop(0.65, "rgb(14 18 44 / 0.45)");
      scrim.addColorStop(1, "rgb(14 18 44 / 0)");
      ctx.fillStyle = scrim;
      ctx.fillRect(0, 0, w, h);

      const g = run.gather;
      const k = rm ? 1 : Math.min(1, (now - g.t0) / GATHER_MS);
      if (k < 1) moving = true;
      const e = ease(k);
      // The beam and the shadows are the first things to go: no beam under
      // reduced motion, neither at minimal quality.
      const fx = {
        beam: rm || q === "minimal" ? null : (now % BEAM_MS) / BEAM_MS,
        flat: q === "minimal",
      };

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
        drawCard(ctx, entries[i].name, { ...rect, y: rect.y + (rm ? 0 : ease(t) * DROP_PX * 2) }, 1 - ease(t), "out", fx);
      });

      // The spotlit card is drawn last, so its lift is never under a neighbour.
      const lit = run.spotlight?.index ?? -1;
      const order = [...g.to.keys()].sort((a, b) => Number(a === lit) - Number(b === lit));
      for (const i of order) {
        const to = g.to.get(i)!;
        const from = g.from.get(i)!;
        let rect: Rect = {
          x: lerp(from.x, to.x, e),
          y: lerp(from.y, to.y, e),
          w: lerp(from.w, to.w, e),
          h: lerp(from.h, to.h, e),
        };
        if (k >= 1) run.lastRect.set(i, to);
        else run.lastRect.set(i, rect);
        // The face-off: one more standing than there are winners, just
        // before the final knock-out (two names, for a single winner).
        const finalPair = landedAt === null && g.to.size <= run.winners.length + 1;
        const shown = landedAt !== null && run.revealed.has(i);
        const isLit = shown && i === lit;
        if (isLit && run.winners.length > 1) {
          const t = rm ? 1 : Math.min(1, (now - run.spotlight!.at) / SPOTLIGHT_MS);
          if (t < 1) moving = true;
          const s = 1 + (SPOTLIGHT_SCALE - 1) * ease(t);
          rect = {
            x: rect.x - (rect.w * (s - 1)) / 2,
            y: rect.y - (rect.h * (s - 1)) / 2,
            w: rect.w * s,
            h: rect.h * s,
          };
        }
        // A single winner's name is carried by the overlay; the card under it
        // bows out as the overlay rises, or its border and glow frame the name
        // from behind like a second, smaller box.
        const soloLanded = landedAt !== null && run.winners.length === 1;
        drawCard(
          ctx,
          entries[i].name,
          rect,
          soloLanded ? 1 - e : Math.min(1, 0.35 + e),
          isLit ? "win" : shown ? "won" : finalPair ? "pair" : "in",
          fx,
        );
      }
    }

    const winnerCount = run ? run.winners.length : 1;
    canvas.dataset.alive = String(landedAt !== null ? winnerCount : standingCount);
    publish({
      alive: standingCount,
      round: run ? Math.min(done + 1, rounds) : 0,
      rounds,
      landed: landedAt !== null,
      total: n,
      winners: winnerCount,
      finalNext: run !== null && landedAt === null && rounds > 0 && done >= rounds - 1,
      // Only ever set once landed: the overlay is the one place the wall
      // puts a name into the DOM, and it must not exist before the reveal.
      // A batch has no single overlay; its names arrive one at a time.
      winnerName:
        run && landedAt !== null && winnerCount === 1 ? entries[run.winners[0]].name : null,
    });

    if (!run) return shimmer;
    if (landedAt === null || moving) return true;
    if (run.spotlight && now - run.spotlight.at < SPOTLIGHT_MS + 100) return true;
    return now - landedAt < FINAL_FADE_MS + GATHER_MS + 200;
  }

  function drawCard(
    ctx: CanvasRenderingContext2D,
    name: string,
    rect: Rect,
    alpha: number,
    kind: "in" | "pair" | "win" | "won" | "out",
    /** `beam`: 0–1 round the border, or null when motion is off. `flat`: minimal quality. */
    fx: { beam: number | null; flat: boolean },
  ) {
    const radius = Math.min(16, rect.h * 0.22);
    const gold = kind === "win" || kind === "won";
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    if (kind === "win") {
      // The spotlit winner glows; winners already revealed keep the gold
      // without the glow, so only one card ever reads as "now".
      ctx.shadowColor = `rgb(${GOLD} / 0.45)`;
      ctx.shadowBlur = rect.h * 0.4;
    } else if (!fx.flat && kind !== "out") {
      // Lifted off the wall: a soft navy shadow, never black (see .stage-bg).
      ctx.shadowColor = "rgb(6 8 24 / 0.55)";
      ctx.shadowBlur = rect.h * 0.3;
      ctx.shadowOffsetY = rect.h * 0.08;
    }
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, radius);
    // Opaque: a translucent card let the wall's names show through. Lit from
    // above — lighter at the top edge — so a card reads as a surface, not a
    // flat rectangle.
    const [top, bottom] =
      kind === "win"
        ? ["62 52 32", "40 34 26"]
        : kind === "won"
          ? ["48 42 32", "34 30 28"]
          : kind === "pair"
            ? ["50 54 88", "30 33 62"]
            : ["38 42 72", "24 27 54"];
    if (fx.flat) {
      ctx.fillStyle = `rgb(${bottom} / 0.97)`;
    } else {
      const face = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
      face.addColorStop(0, `rgb(${top} / 0.97)`);
      face.addColorStop(1, `rgb(${bottom} / 0.97)`);
      ctx.fillStyle = face;
    }
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.lineWidth = kind === "pair" || gold ? 1.5 : 1;
    ctx.strokeStyle =
      kind === "win"
        ? `rgb(${GOLD} / 0.85)`
        : kind === "won"
          ? `rgb(${GOLD} / 0.45)`
          : kind === "pair"
            ? `rgb(${INK} / 0.34)`
            : `rgb(${INK} / 0.16)`;
    ctx.stroke();
    if (!fx.flat) {
      // The lit top edge.
      ctx.fillStyle = gold ? `rgb(${GOLD} / 0.22)` : `rgb(${INK} / 0.14)`;
      ctx.fillRect(rect.x + radius, rect.y + 1, rect.w - radius * 2, 1);
    }
    if (fx.beam !== null && kind === "pair") {
      // A light running round the border of each card in the face-off (the
      // Magic UI border beam, painted). Neutral white: nobody has won yet, and
      // both cards carry it, so it singles out neither.
      const perimeter = 2 * (rect.w + rect.h) - (8 - 2 * Math.PI) * radius;
      ctx.beginPath();
      ctx.roundRect(rect.x, rect.y, rect.w, rect.h, radius);
      ctx.setLineDash([perimeter * 0.16, perimeter * 0.84]);
      ctx.lineDashOffset = -fx.beam * perimeter;
      ctx.lineCap = "round";
      ctx.lineWidth = 2;
      ctx.shadowColor = `rgb(${INK} / 0.7)`;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = `rgb(${INK} / 0.95)`;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
    }
    const px = cardFont(name, rect);
    ctx.font = `600 ${px}px ${fontFamily.current}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = gold ? `rgb(${GOLD})` : `rgb(${INK})`;
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

  // The batch this run is heading for. One id for a normal draw.
  const runKey = (targetIds && targetIds.length ? targetIds : targetId ? [targetId] : []).join("|");
  const revealedKey = (revealedIds ?? (landed && targetId ? [targetId] : [])).join("|");

  // A new target starts a new run. Keyed on the targets alone (see above).
  useEffect(() => {
    if (!runKey) {
      runRef.current = null;
      kick();
      return;
    }
    const { pool: entries, durationMs: d, reducedMotion: rm, quality: q } = live.current;
    const ids = runKey.split("|");
    const winners = ids.map((id) => entries.findIndex((e) => e.id === id));
    if (winners.some((w) => w < 0)) {
      runRef.current = null;
      kick();
      return;
    }
    const plan = planWall(entries.length, winners, runKey);
    const spin = (rm ? 600 : d) * RUN_SHARE;
    const ends = roundEnds(Math.max(0, plan.rounds - 1)).map((f) => f * spin);
    runRef.current = {
      key: runKey,
      pool: entries,
      plan,
      winners,
      winnerSet: new Set(winners),
      revealed: new Set(),
      spotlight: null,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the targets only
  }, [runKey]);

  // The engine revealed another winner of the batch: lift that card. A jump
  // of more than one (a batch too big to spotlight) lights them all at once.
  useEffect(() => {
    const run = runRef.current;
    if (!run) return;
    const next = new Set<number>();
    for (const id of revealedKey ? revealedKey.split("|") : []) {
      const i = run.pool.findIndex((e) => e.id === id);
      if (run.winnerSet.has(i)) next.add(i);
    }
    const added = [...next].filter((i) => !run.revealed.has(i));
    run.revealed = next;
    if (added.length === 1) run.spotlight = { index: added[0], at: performance.now() };
    else if (added.length > 1) run.spotlight = null;
    kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kick is stable in effect
  }, [revealedKey, runKey]);

  // The engine revealed the target: play the final round.
  useEffect(() => {
    const run = runRef.current;
    if (landed && run && run.landedAt === null) {
      run.landedAt = performance.now();
      kick();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kick is stable in effect
  }, [landed, runKey]);

  // Idle roster changes (an import, an undo) redraw the still wall, and a
  // quality or motion change starts or stops the shimmer.
  useEffect(() => {
    if (!runRef.current) kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kick is stable in effect
  }, [pool, quality, reducedMotion]);

  const winnerName = hud.winnerName;
  const sparkle = !reducedMotion && quality !== "minimal";
  // A batch: the names the engine has revealed so far, newest last. Read from
  // props, which only ever hold winners the engine has actually revealed.
  const batchShown =
    hud.landed && hud.winners > 1
      ? (revealedIds ?? [])
          .map((id) => pool.find((p) => p.id === id)?.name)
          .filter((x): x is string => Boolean(x))
      : [];
  // The winner's name wraps to two lines and shrinks to fit rather than being
  // cut off with an ellipsis — a truncated winner is a name nobody can read.
  const [winnerBox, winnerPx] = useFittedSize(winnerName, { maxLines: 2, maxVh: 15, maxPx: 144, minPx: 36, weight: 700 });

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* The wall has the whole screen. A count line used to sit above it
          ("249 still in", "1 winner, from 249 in the draw"); on the projector
          it read as a page title over the one thing the room is watching, and
          it cost the names a row. The wall thinning out is the count. What is
          left is for screen readers, and changes once a round, not once a
          name. */}
      <p role="status" className="sr-only">
        {hud.landed
          ? `${hud.winners} ${hud.winners === 1 ? "winner" : "winners"}, from ${hud.total} in the draw`
          : hud.rounds > 0
            ? `Round ${hud.round} of ${hud.rounds}`
            : `${hud.total} in the draw`}
      </p>

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
                "radial-gradient(ellipse 64% 48% at 50% 50%, rgb(14 18 44 / 0.95) 0%, rgb(14 18 44 / 0.8) 55%, transparent 88%)",
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
              <div
                className="stage-name name-mixed block text-center text-gold-bright [overflow-wrap:anywhere] [text-wrap:balance]"
                style={winnerPx ? { fontSize: winnerPx, lineHeight: 1.05 } : undefined}
              >
                {/* Sparkles only with motion on, and dropped at minimal
                    quality: the component re-renders ten times a second,
                    cheap for one name but not on a laptop already dropping
                    frames. Size and weight are inherited so the fitted size
                    still holds. */}
                {sparkle ? (
                  <SparklesText
                    sparklesCount={12}
                    colors={{ first: "#f2d68a", second: "#ffffff" }}
                    className="text-[length:inherit] leading-[inherit] font-[inherit] [&_strong]:font-[inherit]"
                  >
                    {winnerName}
                  </SparklesText>
                ) : (
                  winnerName
                )}
              </div>
            </div>
            <span className="relative flex items-center gap-4 text-[min(2.2vh,1.4rem)] text-ink-500">
              <span aria-hidden className="h-px w-10 bg-gold/50" />
              last name standing of {hud.total}
              <span aria-hidden className="h-px w-10 bg-gold/50" />
            </span>
          </div>
        ) : null}
        {batchShown.length > 0 ? (
          // One line under the cards: who has just been called, and how many
          // of the batch are out so far.
          <div
            data-testid="reveal-winner"
            className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-[0.8vh] pt-[3vh] pb-[1vh]"
            style={{
              background:
                "radial-gradient(ellipse 45% 70% at 50% 70%, rgb(14 18 44 / 0.92), transparent 80%)",
            }}
          >
            <span className="flex items-center gap-4 text-[min(2.2vh,1.4rem)] text-ink-500 tabular-nums">
              <span aria-hidden className="h-px w-10 bg-gold/50" />
              {hud.winners > WALL_SPOTLIGHT_MAX
                ? `${hud.winners} winners`
                : `Winner ${batchShown.length} of ${hud.winners}`}
              <span aria-hidden className="h-px w-10 bg-gold/50" />
            </span>
            {/* Sized inline: `.stage-name` is unlayered and its font-size beats
                any text-* utility, which put this line at headline size on top
                of the cards. */}
            {hud.winners > WALL_SPOTLIGHT_MAX ? null : (
              // Keyed per spotlight, so each newly called name blurs in word
              // by word. Only revealed names ever reach this line.
              <TextAnimate
                key={batchShown.length}
                as="span"
                animation="blurInUp"
                by="word"
                startOnView={false}
                className="name-mixed max-w-[90%] truncate text-center font-semibold leading-tight tracking-tight text-gold-bright"
                style={{ fontSize: "min(4.2vh, 2.8rem)" }}
              >
                {batchShown[batchShown.length - 1]}
              </TextAnimate>
            )}
            <span className="sr-only">{batchShown.join(", ")}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
