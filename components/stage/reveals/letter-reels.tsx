"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { canvasMeasure, fitFontSize } from "@/lib/stage/fit-text";
import { graphemes, planLetters, type LetterPlan } from "@/lib/stage/letter-plan";
import { RUN_SHARE, type RevealProps } from "./types";

/*
 * Narrowing reels: still a slot machine, but one that works for a big room.
 *
 * Letter reels lock the winner's first characters one at a time, and the
 * count above them drops with each ("236 in the draw → 29 start with S → 6
 * start with So"). Once the field is small enough to read, a name reel turns
 * slowly through only those names and stops on the winner when the engine
 * reveals. The old full-roster reel streamed hundreds of names past in a blur
 * and nobody saw themselves; here the last reel only ever turns through a
 * handful, slowly enough to read every one.
 *
 * The plan (letters, counts, finalists) is `lib/stage/letter-plan.ts`, which is
 * unit-tested to only ever lock the winner's own letters and to report true
 * counts. This component just plays it: reel text is written imperatively from
 * one rAF loop, and React state changes only when a letter locks.
 */

const LETTER_MS = 60;
const NAME_MS = 420;
const ROW_H = "min(13vh, 9rem)";

interface Run {
  targetId: string;
  plan: LetterPlan;
  /** ms from t0 at which each letter reel locks. */
  lockAt: number[];
  /** ms from t0 at which the name reel starts turning. */
  nameFrom: number;
  t0: number;
  landedAt: number | null;
  alphabet: string[];
  /** Last finalist index shown, for one tick per name. */
  lastStep: number;
}

export function LetterReels({
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

  const plan = useMemo(
    () => (targetId && pool.some((p) => p.id === targetId) ? planLetters(pool, targetId) : null),
    [pool, targetId],
  );

  const runRef = useRef<Run | null>(null);
  const rafRef = useRef<number | null>(null);
  const letterRefs = useRef<(HTMLSpanElement | null)[][]>([]);
  const nameRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [locked, setLocked] = useState(0);
  const lockedRef = useRef(0);
  const [nameOn, setNameOn] = useState(false);
  // null forces the first paint of a run to publish, so a previous run's
  // lock count or name reel never lingers into the next one.
  const nameOnRef = useRef<boolean | null>(null);

  const fitWinner = (el: HTMLElement, text: string): string => {
    // Read the class size, not a previous fit: clear the inline size first.
    el.style.fontSize = "";
    const cs = getComputedStyle(el);
    const max = parseFloat(cs.fontSize) || 80;
    const width = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const px = fitFontSize(text, {
      maxWidth: width,
      maxLines: 1,
      max,
      min: Math.max(24, max * 0.4),
      measure: canvasMeasure(600, cs.fontFamily),
    });
    return px >= max ? "" : `${px}px`;
  };

  const paint = (now: number): boolean => {
    const run = runRef.current;
    if (!run) return false;
    const elapsed = now - run.t0;
    const { reducedMotion: rm, quality: q } = live.current;
    const churn = !rm && q !== "minimal";
    const done = run.landedAt !== null;

    let lockedNow = 0;
    run.plan.letters.forEach((letter, i) => {
      const isLocked = done || elapsed >= run.lockAt[i];
      if (isLocked) lockedNow++;
      const rows = letterRefs.current[i] ?? [];
      const a = run.alphabet;
      const at = a.indexOf(letter.toLocaleUpperCase());
      const spinIdx = Math.floor(elapsed / LETTER_MS) + i * 5;
      [-1, 0, 1].forEach((off, k) => {
        const el = rows[k];
        if (!el) return;
        const ch = isLocked
          ? off === 0
            ? letter
            : (a[(at + off + a.length) % a.length] ?? "")
          : churn
            ? (a[(spinIdx + off + a.length * 4) % a.length] ?? "")
            : off === 0
              ? "·"
              : "";
        if (el.textContent !== ch) el.textContent = ch;
        el.dataset.state = isLocked ? "set" : "spin";
      });
    });
    if (lockedNow !== lockedRef.current) {
      lockedRef.current = lockedNow;
      setLocked(lockedNow);
      live.current.onTick?.();
    }

    const turning = done || elapsed >= run.nameFrom;
    if (turning !== nameOnRef.current) {
      nameOnRef.current = turning;
      setNameOn(turning);
    }
    if (turning) {
      const f = run.plan.finalists;
      const step = done ? run.plan.winner : Math.floor((elapsed - run.nameFrom) / NAME_MS) % f.length;
      [-1, 0, 1].forEach((off, k) => {
        const el = nameRefs.current[k];
        if (!el) return;
        const text = f[(step + off + f.length) % f.length]?.name ?? "";
        if (el.textContent !== text) el.textContent = text;
        el.dataset.state = done ? (off === 0 ? "win" : "dim") : rm ? "set" : "spin";
        // The landed winner shrinks to fit the reel rather than truncating.
        if (off === 0) {
          const px = done ? fitWinner(el, text) : "";
          if (el.style.fontSize !== px) el.style.fontSize = px;
        }
      });
      if (!done && run.lastStep !== step) {
        run.lastStep = step;
        live.current.onTick?.();
      }
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

  useEffect(() => {
    lockedRef.current = -1;
    nameOnRef.current = null;
    if (!targetId || !plan) {
      runRef.current = null;
      return;
    }
    const { pool: entries, durationMs: d } = live.current;
    const L = plan.letters.length;
    const span = d * RUN_SHARE;
    const lockAt = plan.letters.map((_, i) => ((i + 1) / (L + 1)) * span);
    const alphabet = Array.from(
      new Set(entries.map((e) => (graphemes(e.name)[0] ?? "").toLocaleUpperCase()).filter(Boolean)),
    ).sort();
    for (const l of plan.letters) {
      const u = l.toLocaleUpperCase();
      if (!alphabet.includes(u)) alphabet.push(u);
    }
    runRef.current = {
      targetId,
      plan,
      lockAt,
      nameFrom: L === 0 ? 0 : lockAt[L - 1] + 250,
      t0: performance.now(),
      landedAt: null,
      alphabet,
      lastStep: -1,
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

  const won = Boolean(targetId && landed && plan);
  const running = Boolean(targetId && plan);
  const letters = plan?.letters ?? [];
  const counts = plan?.counts ?? [pool.length];
  const shownLocked = running ? (won ? letters.length : locked) : 0;
  const nameVisible = running && nameOn;

  const steps: { n: string; label: string; current: boolean; gold?: boolean }[] = [
    { n: String(counts[0]), label: "in the draw", current: shownLocked === 0 && !won },
  ];
  for (let i = 0; i < shownLocked; i++) {
    steps.push({
      n: String(counts[i + 1]),
      label: `start with ${letters.slice(0, i + 1).join("")}`,
      current: i === shownLocked - 1 && !won,
    });
  }
  if (won) steps.push({ n: "1", label: "winner", current: true, gold: true });

  const winnerName = won && plan ? plan.finalists[plan.winner].name : null;

  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-[5vh]">
      <div role="status" className="flex flex-wrap items-baseline justify-center gap-x-[1.6vw] gap-y-2">
        {steps.map((s, i) => (
          <span key={i} className="flex items-baseline gap-[0.6vw]">
            {i > 0 ? (
              <span aria-hidden className="mr-[0.6vw] text-[min(2.4vh,1.5rem)] text-ink-100/25">
                →
              </span>
            ) : null}
            <span
              className={`font-semibold tracking-tight tabular-nums ${
                s.current ? "text-[min(6vh,4rem)]" : "text-[min(3.6vh,2.4rem)]"
              } ${s.gold ? "text-gold-bright" : s.current ? "text-ink-100" : "text-ink-500"}`}
            >
              {s.n}
            </span>
            <span className="text-[min(2vh,1.3rem)] text-ink-500">{s.label}</span>
          </span>
        ))}
      </div>

      <div className="relative flex items-center gap-[1.1vw]">
        {(running ? letters : ["", ""]).map((_, i) => {
          const isLocked = running && i < shownLocked;
          return (
            <div
              key={`${targetId ?? "idle"}-${i}`}
              aria-hidden
              className={`relative flex w-[min(9vw,15vh)] flex-col items-center overflow-hidden rounded-[1.4vw] bg-gradient-to-b from-[#0b0c0f] via-[#111216] to-[#0b0c0f] ${
                won
                  ? "shadow-[inset_0_0_0_1px_rgb(242_214_138/0.35)]"
                  : isLocked
                    ? "shadow-[inset_0_0_0_1px_rgb(255_255_255/0.16)]"
                    : "shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]"
              }`}
            >
              {[0, 1, 2].map((k) => (
                <span
                  key={k}
                  ref={(el) => {
                    (letterRefs.current[i] ??= [])[k] = el;
                  }}
                  data-state="idle"
                  className={`flex w-full items-center justify-center font-semibold leading-none data-[state=spin]:blur-[3px] data-[state=spin]:opacity-50 ${
                    k === 1
                      ? `text-[min(11vh,7rem)] ${won ? "text-gold-bright" : "text-ink-100"}`
                      : "text-[min(5vh,3.4rem)] text-ink-100 opacity-15"
                  }`}
                  style={{ height: k === 1 ? ROW_H : `calc(${ROW_H} * 0.6)` }}
                />
              ))}
              <span
                aria-hidden
                className={`absolute bottom-[1.2vh] left-1/2 h-[3px] w-[1.6vw] -translate-x-1/2 rounded-full ${
                  won ? "bg-gold-bright" : isLocked ? "bg-ink-100" : "bg-ink-100/15"
                }`}
              />
            </div>
          );
        })}

        <div
          aria-hidden
          className={`relative flex w-[min(52vw,90vh)] flex-col overflow-hidden rounded-[1.4vw] bg-gradient-to-b from-[#0b0c0f] via-[#111216] to-[#0b0c0f] ${
            won
              ? "shadow-[inset_0_0_0_1px_rgb(242_214_138/0.35)]"
              : nameVisible
                ? "shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]"
                : "shadow-[inset_0_0_0_1px_rgb(255_255_255/0.05)]"
          }`}
        >
          {[0, 1, 2].map((k) => (
            <span
              key={k}
              ref={(el) => {
                nameRefs.current[k] = el;
              }}
              data-state="idle"
              className={`name-mixed flex w-full items-center truncate px-[3vw] font-semibold tracking-[-0.03em] data-[state=spin]:blur-[1px] ${
                k === 1
                  ? "text-[min(8vh,5.5rem)] text-ink-100 data-[state=win]:text-gold-bright data-[state=win]:[text-shadow:0_0_6vh_rgb(242_214_138/0.35)]"
                  : "text-[min(4vh,2.8rem)] text-ink-100 opacity-30 data-[state=dim]:opacity-10"
              } ${nameVisible ? "" : "invisible"}`}
              style={{ height: k === 1 ? ROW_H : `calc(${ROW_H} * 0.6)` }}
            />
          ))}
          {!nameVisible ? (
            <span className="absolute inset-0 flex items-center justify-center text-[min(2vh,1.3rem)] text-ink-500">
              Turns once the field is small enough to read
            </span>
          ) : null}
        </div>

      </div>

      {won && winnerName ? (
        <span data-testid="reveal-winner" className="sr-only">
          {winnerName}
        </span>
      ) : null}
    </div>
  );
}
