"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { canvasMeasure, fitFontSize } from "@/lib/stage/fit-text";
import { useFittedSize } from "./use-fitted-size";
import type { RevealEntry, RevealProps } from "./types";

/*
 * The envelope: a wheel of name cards turning in 3D, braking onto one card,
 * which lifts out face down and turns over to show the winner.
 *
 * Motion model (ported from the design canvas, where it was tuned):
 *
 * - The wheel has an angle and a velocity, integrated each frame from one rAF
 *   loop and written straight to the ring's transform — never React state, so
 *   nothing that re-renders can make it stutter. Speed changes ease the
 *   velocity toward a target; swapping a CSS animation-duration instead made
 *   the wheel jump.
 * - Braking is an ease-out tween to a stopping angle whose starting speed
 *   matches the wheel's (an ease-out cubic starts at 3 × distance / time),
 *   rounded up to the next card, so the wheel coasts to rest with one card at
 *   the front — and that card is the one that lifts out.
 * - The drawn card starts at that card's exact size and place, glides up with
 *   one long ease-out, then flips with an arc towards the viewer while it
 *   grows, at `landed`.
 *
 * The contract (`./types.ts`): keyed on `targetId`, timings read once when
 * the run starts, and the face — the only place the winner's name appears —
 * is not rendered until `landed`. The wheel never shows the winner's card.
 *
 * Cost: up to 48 cards in 3D. The frame budget steps that down (36 at
 * reduced, 24 at minimal, no blur), and reduced motion stops the wheel and
 * skips the arc.
 */

const SPEED_IDLE = 360 / 70;
const SPEED_SHUFFLE = 360 / 4.2;
const LIFT =
  "transform 1300ms cubic-bezier(0.16, 1, 0.3, 1), opacity 1300ms cubic-bezier(0.16, 1, 0.3, 1)";
const GROW =
  "transform 1150ms cubic-bezier(0.22, 1, 0.36, 1), opacity 900ms ease-out";

type Lift = null | "start" | "up" | "grown";

interface RunState {
  /** The target this state belongs to; a new target resets it during render. */
  runFor: string | null;
  lift: Lift;
  pickIdx: number;
}

function initials(name: string): string {
  if (/[ក-៿]/.test(name)) return "";
  const w = name.trim().split(/\s+/);
  return (w[0][0] + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase();
}

/**
 * The deck: everyone but the winner, in a stable shuffled order. The winner's
 * card is never on the wheel — a card with their name passing the front would
 * read as a hint.
 */
function deckOf(pool: RevealEntry[], skip: string | null, key: string): RevealEntry[] {
  const out = pool.filter((p) => p.id !== skip);
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let x = h >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    const j = x % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Size the wheel to the box it has. The ring used to be sized from height
 * alone, and on the stage column — narrower than the screen once the winners
 * list is showing — its side cards ran past the edges. The radius is now the
 * largest whose widest projected point (perspective included) stays inside
 * the box, and the card count is however many fit around that ring.
 */
function wheelGeometry(w: number, h: number, cap: number) {
  const u = Math.max(64, Math.min(h * 0.22, w * 0.105));
  const p = u * 10.4;
  const half = Math.max(u * 1.5, w / 2 - u * 0.55);
  const widest = (r: number) => {
    let m = 0;
    for (let deg = 0; deg <= 180; deg += 3) {
      const t = (deg * Math.PI) / 180;
      m = Math.max(m, (r * Math.sin(t) * p) / (p + r * (1 - Math.cos(t))));
    }
    return m;
  };
  let lo = u;
  let hi = u * 5.36;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (widest(mid) <= half) lo = mid;
    else hi = mid;
  }
  const r = lo;
  const count = Math.max(12, Math.min(cap, Math.floor((2 * Math.PI * r) / (u * 0.69 * 1.08))));
  return { u, p, r, count, step: 360 / count };
}

export function Envelope({
  pool,
  targetId,
  landed,
  durationMs,
  reducedMotion,
  quality,
  onTick,
}: RevealProps) {
  const live = useRef({ durationMs, reducedMotion, onTick });
  useLayoutEffect(() => {
    live.current = { durationMs, reducedMotion, onTick };
  });

  const cap = quality === "minimal" ? 24 : quality === "reduced" ? 36 : 48;

  const [run, setRun] = useState<RunState>({ runFor: null, lift: null, pickIdx: -1 });
  // A new target starts a fresh run. Adjusted during render, so the previous
  // run's lifted card never flashes up for a frame on the next draw.
  if (run.runFor !== targetId) {
    setRun({ runFor: targetId, lift: null, pickIdx: -1 });
  }
  const lift: Lift = run.runFor === targetId ? run.lift : null;
  const turned = Boolean(targetId && landed);
  const shownLift: Lift = turned ? "grown" : lift;

  // Size everything from the box: one unit = a wheel card's height.
  const rootRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const geo = useMemo(() => wheelGeometry(box.w, box.h, cap), [box.w, box.h, cap]);
  const { u, count, step } = geo;

  /*
   * Every participant passes through the wheel. There are only `count` card
   * slots in the DOM, but a slot takes the next block of names each time it
   * passes behind the wheel, where nobody can see it change — so over the
   * shuffle the whole deck goes past the front, the way the classic reel
   * streams the whole roster through a window of rows. The label for a slot
   * is a pure function of the wheel's angle, so it never drifts.
   */
  const deck = useMemo(
    () => deckOf(pool, targetId, targetId ?? "idle"),
    // Re-deal on a new draw, not on every roster fold.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetId, pool.length],
  );
  const slotNames = useRef<(HTMLSpanElement | null)[]>([]);
  const slotInis = useRef<(HTMLSpanElement | null)[]>([]);
  const slotPass = useRef<number[]>([]);
  const sizeCache = useRef(new Map<string, number>());
  const wheel = useRef({ deck, geo });
  useLayoutEffect(() => {
    wheel.current = { deck, geo };
    // Freshly rendered slots carry their initial labels; relabel from scratch.
    slotPass.current = [];
    sizeCache.current.clear();
  }, [deck, geo]);

  const targetName = targetId ? (pool.find((p) => p.id === targetId)?.name ?? null) : null;
  const [faceRef, winPx] = useFittedSize(turned ? targetName : null, {
    maxLines: 3,
    maxVh: 8.6,
    minPx: 32,
  });

  /** Give each slot the name for its current pass round the back of the wheel. */
  const relabel = (angle: number) => {
    const { deck: d, geo: g } = wheel.current;
    if (d.length === 0) return;
    for (let i = 0; i < g.count; i++) {
      // Passes completed behind the wheel (180° from the front) so far.
      const pass = Math.floor((angle - g.step * i + 180) / 360);
      if (slotPass.current[i] === pass) continue;
      slotPass.current[i] = pass;
      const entry = d[(((i + g.count * pass) % d.length) + d.length) % d.length];
      const nameEl = slotNames.current[i];
      const iniEl = slotInis.current[i];
      if (nameEl) {
        nameEl.textContent = entry.name;
        nameEl.style.fontSize = `${sizeFor(entry.name, g.u)}px`;
      }
      if (iniEl) iniEl.textContent = initials(entry.name);
    }
  };

  const sizeFor = (name: string, unit: number) => {
    const hit = sizeCache.current.get(name);
    if (hit !== undefined) return hit;
    const px = fitFontSize(name, {
      maxWidth: unit * 0.56,
      maxLines: 3,
      max: 0.077 * unit,
      min: 0.055 * unit,
      step: 1,
      measure: canvasMeasure(600, "Geist, 'Noto Sans Khmer', sans-serif"),
    });
    sizeCache.current.set(name, px);
    return px;
  };

  // The loop is mounted once; it reaches the latest `relabel` through a ref.
  const relabelRef = useRef(relabel);
  useLayoutEffect(() => {
    relabelRef.current = relabel;
  });

  // ---- The wheel's motion ------------------------------------------------
  const ringRef = useRef<HTMLDivElement>(null);
  const motion = useRef({ angle: 0, v: SPEED_IDLE, target: SPEED_IDLE, brake: null as null | { a0: number; a1: number; t0: number; ms: number } });

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const m = motion.current;
      if (m.brake) {
        const k = Math.min(1, (t - m.brake.t0) / m.brake.ms);
        m.angle = m.brake.a0 + (m.brake.a1 - m.brake.a0) * (1 - Math.pow(1 - k, 3));
        if (k >= 1) {
          m.brake = null;
          m.v = 0;
        }
      } else {
        const target = live.current.reducedMotion ? 0 : m.target;
        m.v += (target - m.v) * (1 - Math.exp(-dt * 3.2));
        m.angle += m.v * dt;
      }
      const ring = ringRef.current;
      if (ring) ring.style.transform = `rotateY(${(-m.angle).toFixed(3)}deg)`;
      relabelRef.current(m.angle);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // A run: shuffle, brake onto a card, lift it. Keyed on the target alone.
  useEffect(() => {
    const m = motion.current;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let raf = 0;
    if (!targetId) {
      m.brake = null;
      m.target = SPEED_IDLE;
      return;
    }
    const { durationMs: d, reducedMotion: rm } = live.current;
    const front = () => {
      const { count: n, step: st } = wheel.current.geo;
      return ((Math.round(m.angle / st) % n) + n) % n;
    };
    const lifted = () => {
      setRun({ runFor: targetId, lift: "start", pickIdx: front() });
      live.current.onTick?.();
      // Two frames: paint the card at the wheel's position, then release it.
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => setRun((r) => (r.runFor === targetId ? { ...r, lift: "up" } : r)));
      });
    };

    if (rm) {
      const st = wheel.current.geo.step;
      m.angle = Math.round(m.angle / st) * st;
      m.v = 0;
      timers.push(setTimeout(() => setRun({ runFor: targetId, lift: "up", pickIdx: front() }), 0));
    } else {
      m.target = SPEED_SHUFFLE;
      const brakeAt = d * 0.35;
      const brakeMs = Math.min(1700, Math.max(500, d * 0.25));
      timers.push(
        setTimeout(() => {
          const a0 = m.angle;
          const natural = (m.v * (brakeMs / 1000)) / 3;
          const st = wheel.current.geo.step;
          m.brake = { a0, a1: Math.ceil((a0 + natural) / st) * st, t0: performance.now(), ms: brakeMs };
          m.target = 0;
        }, brakeAt),
      );
      timers.push(setTimeout(lifted, brakeAt + brakeMs + 100));
    }
    return () => {
      timers.forEach(clearTimeout);
      cancelAnimationFrame(raf);
    };
  }, [targetId]);

  // ---- Layout --------------------------------------------------------------
  const drawn = shownLift !== null || turned;
  const up = shownLift === "up" || shownLift === "grown";
  const ringCenterY = box.h * 0.64;
  const cardCenterY = box.h * 0.46;
  const liftY = shownLift === "start" ? ringCenterY - cardCenterY : 0;
  const liftScale = shownLift === "start" ? 1 / 3 : turned ? 1 : 0.5;
  const rm = reducedMotion;
  const liftTransition = shownLift === "start" || rm ? "none" : turned ? GROW : LIFT;

  const status = turned
    ? "The card is turned"
    : drawn
      ? "One card drawn, face down"
      : targetId
        ? "Shuffling the deck"
        : "Waiting for the draw";

  const unit = { "--u": `${u}px` } as CSSProperties;

  return (
    <div ref={rootRef} className="relative h-full min-h-0 w-full overflow-hidden" style={unit}>
      <div className="absolute inset-x-0 top-[2vh] flex flex-col items-center gap-[0.8vh]">
        <p role="status" className="text-[min(1.8vh,1.15rem)] font-medium uppercase tracking-[0.14em] text-ink-500">
          {status}
        </p>
        <p className="text-[min(1.6vh,1rem)] text-ink-500/70">
          {pool.length} {pool.length === 1 ? "name" : "names"} in the deck
        </p>
      </div>

      {/* Floor light */}
      <div
        aria-hidden
        className="absolute left-[12%] right-[12%] top-[70%] h-[26%] rounded-[50%] transition-opacity duration-700"
        style={{
          background: "radial-gradient(ellipse at 50% 40%, rgb(242 214 138 / 0.1), transparent 70%)",
          opacity: turned ? 1 : targetId ? 0.9 : 0.5,
        }}
      />

      {/* The wheel */}
      <div
        aria-hidden
        className="absolute inset-0 transition-[opacity,filter] duration-[1100ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{
          perspective: geo.p,
          perspectiveOrigin: "50% 30%",
          opacity: turned ? 0.14 : drawn ? 0.42 : 1,
          filter: quality === "minimal" ? "none" : `blur(${turned ? 3 : drawn ? 0.6 : 0}px)`,
        }}
      >
        <div
          className="absolute left-1/2 [transform-style:preserve-3d]"
          style={{ top: ringCenterY, transform: `translateZ(${-geo.r}px) rotateX(-9deg)` }}
        >
          <div ref={ringRef} className="[transform-style:preserve-3d] will-change-transform">
            {Array.from({ length: deck.length === 0 ? 0 : count }, (_, i) => (
              <div
                key={i}
                className="absolute [transform-style:preserve-3d]"
                style={{
                  width: u * 0.69,
                  height: u,
                  left: -u * 0.345,
                  top: -u / 2,
                  transform: `rotateY(${step * i}deg) translateZ(${geo.r}px)`,
                  opacity: i === run.pickIdx && drawn ? 0 : 1,
                }}
              >
                {/* Front */}
                <div className="absolute inset-0 overflow-hidden rounded-[calc(var(--u)*0.064)] bg-[linear-gradient(160deg,#22232a_0%,#15161b_55%,#101115_100%)] p-[calc(var(--u)*0.064)] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1),0_calc(var(--u)*0.06)_calc(var(--u)*0.14)_rgb(0_0_0/0.55)] [backface-visibility:hidden]">
                  <div className="absolute inset-[calc(var(--u)*0.032)] rounded-[calc(var(--u)*0.04)] shadow-[inset_0_0_0_1px_rgb(242_214_138/0.22)]" />
                  <span
                    ref={(el) => {
                      slotInis.current[i] = el;
                    }}
                    className="absolute -right-[calc(var(--u)*0.03)] bottom-[calc(var(--u)*0.12)] text-[calc(var(--u)*0.44)] leading-none font-semibold tracking-[-0.06em] text-white/[0.045]"
                  />
                  <div className="relative flex h-full flex-col justify-between">
                    <span className="ml-auto size-[calc(var(--u)*0.023)] rounded-full bg-[#c9a24a]" />
                    {/* Labelled from the animation loop as the wheel turns. */}
                    <span
                      ref={(el) => {
                        slotNames.current[i] = el;
                      }}
                      className="name-mixed line-clamp-3 font-semibold tracking-[-0.01em] [overflow-wrap:anywhere] text-[#f0f0f2]"
                      style={{ fontSize: 0.077 * u, lineHeight: 1.25 }}
                    />
                  </div>
                </div>
                {/* Back */}
                <div
                  className="absolute inset-0 flex items-center justify-center rounded-[calc(var(--u)*0.064)] [backface-visibility:hidden] [transform:rotateY(180deg)] shadow-[inset_0_0_0_1px_rgb(242_214_138/0.4),inset_0_0_0_calc(var(--u)*0.032)_#15161a,inset_0_0_0_calc(var(--u)*0.032_+_1px)_rgb(242_214_138/0.18)]"
                  style={{ background: "repeating-radial-gradient(circle at 50% 50%, #17181d 0px, #17181d 5px, #1d1e24 5px, #1d1e24 6px)" }}
                >
                  <span className="grid size-[calc(var(--u)*0.155)] place-items-center rounded-[calc(var(--u)*0.045)] bg-[#0a0a0b] shadow-[0_0_0_1px_rgb(242_214_138/0.35)]">
                    <span className="size-[calc(var(--u)*0.045)] rounded-full bg-gold-bright" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* The drawn card */}
      {drawn ? (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 size-[calc(var(--u)*4.5)] -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity duration-[1200ms]"
            style={{
              top: cardCenterY,
              background: `radial-gradient(circle, rgb(242 214 138 / ${turned ? 0.2 : 0.09}), transparent 62%)`,
              opacity: up ? 1 : 0,
            }}
          />
          <div
            className="absolute left-1/2"
            style={{
              top: cardCenterY,
              width: u * 2.09,
              height: u * 3,
              marginLeft: -u * 1.045,
              marginTop: -u * 1.5,
              transform: `translateY(${liftY}px) scale(${liftScale}) rotateX(${shownLift === "start" ? -9 : 0}deg)`,
              transition: liftTransition,
            }}
          >
            <div className={`size-full [perspective:calc(var(--u)*12)] ${rm ? "" : "animate-[card-hover_3.2s_ease-in-out_1.3s_infinite]"}`}>
              <div
                className="relative size-full [transform-style:preserve-3d]"
                style={
                  turned
                    ? rm
                      ? { transform: "rotateY(180deg)" }
                      : { animation: "card-flip 1150ms cubic-bezier(0.65, 0, 0.35, 1) 60ms both" }
                    : undefined
                }
              >
                {/* Back (face down) */}
                <div
                  aria-hidden
                  className="absolute inset-0 grid place-items-center rounded-[calc(var(--u)*0.136)] [backface-visibility:hidden] shadow-[inset_0_0_0_2px_rgb(242_214_138/0.55),inset_0_0_0_calc(var(--u)*0.082)_#15161a,inset_0_0_0_calc(var(--u)*0.082_+_2px)_rgb(242_214_138/0.25),0_calc(var(--u)*0.23)_calc(var(--u)*0.55)_rgb(0_0_0/0.7),0_0_calc(var(--u)*0.4)_rgb(242_214_138/0.18)]"
                  style={{ background: "repeating-radial-gradient(circle at 50% 50%, #17181d 0px, #17181d 12px, #1e1f25 12px, #1e1f25 14px)" }}
                >
                  <span className="grid size-[calc(var(--u)*0.42)] place-items-center rounded-[calc(var(--u)*0.11)] bg-[#0a0a0b] shadow-[0_0_0_2px_rgb(242_214_138/0.45),0_0_calc(var(--u)*0.18)_rgb(242_214_138/0.25)]">
                    <span className="size-[calc(var(--u)*0.12)] rounded-full bg-gold-bright shadow-[0_0_calc(var(--u)*0.11)_rgb(242_214_138/0.8)]" />
                  </span>
                </div>
                {/* Face — only exists once turned, so the name is never in the DOM early. */}
                <div className="absolute inset-0 overflow-hidden rounded-[calc(var(--u)*0.136)] bg-[linear-gradient(160deg,#24252c_0%,#16171c_55%,#101115_100%)] p-[calc(var(--u)*0.19)] [backface-visibility:hidden] [transform:rotateY(180deg)] shadow-[inset_0_0_0_2px_rgb(242_214_138/0.6),0_calc(var(--u)*0.23)_calc(var(--u)*0.55)_rgb(0_0_0/0.7),0_0_calc(var(--u)*0.45)_rgb(242_214_138/0.2)]">
                  {turned && targetName ? (
                    <>
                      <div className="absolute inset-[calc(var(--u)*0.073)] rounded-[calc(var(--u)*0.082)] shadow-[inset_0_0_0_1px_rgb(242_214_138/0.3)]" />
                      <span aria-hidden className="absolute -right-[calc(var(--u)*0.06)] bottom-[calc(var(--u)*0.32)] text-[calc(var(--u)*1.36)] leading-none font-semibold tracking-[-0.07em] text-gold-bright/[0.07]">
                        {initials(targetName)}
                      </span>
                      <div className="relative flex h-full flex-col justify-between">
                        <span className="text-[calc(var(--u)*0.068)] font-medium uppercase tracking-[0.14em] text-gold/80">
                          The winner is
                        </span>
                        <div ref={faceRef} className="w-full">
                          <span
                            data-testid="reveal-winner"
                            className="name-mixed block font-semibold tracking-[-0.035em] text-gold-bright [overflow-wrap:anywhere] [text-shadow:0_0_calc(var(--u)*0.27)_rgb(242_214_138/0.35)] [text-wrap:balance]"
                            style={{ fontSize: winPx ?? u * 0.4, lineHeight: winPx && winPx < u * 0.33 ? 1.1 : 1.03 }}
                          >
                            {targetName}
                          </span>
                        </div>
                        <span className="flex items-center justify-between text-[calc(var(--u)*0.082)] text-ink-500">
                          <span className="flex items-center gap-[calc(var(--u)*0.055)]">
                            <span aria-hidden className="h-px w-[calc(var(--u)*0.18)] bg-gold/55" />1 card of {pool.length}
                          </span>
                          <span aria-hidden className="size-[calc(var(--u)*0.045)] rounded-full bg-gold-bright shadow-[0_0_calc(var(--u)*0.064)_rgb(242_214_138/0.8)]" />
                        </span>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
