"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { Quality } from "@/lib/hooks/use-frame-budget";

export interface ConfettiHandle {
  burst: () => void;
  stop: () => void;
}

interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  spin: number;
  hue: number;
  life: number;
}

const POOL_SIZE = 180;
const COLORS = ["#d4af37", "#f2d68a", "#ffffff", "#8a6d1f", "#c3cbdb"];

function densityFor(quality: Quality) {
  if (quality === "minimal") return 0;
  if (quality === "reduced") return 70;
  return POOL_SIZE;
}

/**
 * One persistent canvas with a pre-allocated particle pool.
 *
 * v2 conditionally mounted its confetti and never cancelled the rAF loop in a
 * cleanup, so each open/close left an orphan loop drawing 500 particles into a
 * detached canvas. This component stays mounted, is driven imperatively, and
 * cancels its loop on unmount.
 */
export const Confetti = forwardRef<ConfettiHandle, { quality: Quality }>(
  function Confetti({ quality }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const poolRef = useRef<Particle[]>([]);
    const rafRef = useRef<number | null>(null);
    const activeRef = useRef(0);
    const qualityRef = useRef(quality);

    useEffect(() => {
      qualityRef.current = quality;
    }, [quality]);

    if (poolRef.current.length === 0) {
      poolRef.current = Array.from({ length: POOL_SIZE }, () => ({
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        size: 0,
        rotation: 0,
        spin: 0,
        hue: 0,
        life: 0,
      }));
    }

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const resize = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(window.innerWidth * dpr);
        canvas.height = Math.floor(window.innerHeight * dpr);
        canvas.style.width = `${window.innerWidth}px`;
        canvas.style.height = `${window.innerHeight}px`;
        canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
      };

      resize();
      window.addEventListener("resize", resize);

      // The single cleanup that v2 was missing.
      return () => {
        window.removeEventListener("resize", resize);
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      };
    }, []);

    useImperativeHandle(ref, () => ({
      burst() {
        const count = densityFor(qualityRef.current);
        if (count === 0) return;

        const width = window.innerWidth;
        let spawned = 0;
        for (const p of poolRef.current) {
          if (spawned >= count) break;
          if (p.active) continue;
          p.active = true;
          p.x = width * (0.15 + Math.random() * 0.7);
          p.y = -20 - Math.random() * 120;
          p.vx = (Math.random() - 0.5) * 3.2;
          p.vy = 2 + Math.random() * 3.5;
          p.size = 5 + Math.random() * 8;
          p.rotation = Math.random() * Math.PI * 2;
          p.spin = (Math.random() - 0.5) * 0.24;
          p.hue = Math.floor(Math.random() * COLORS.length);
          p.life = 1;
          spawned++;
          activeRef.current++;
        }
        start();
      },
      stop() {
        for (const p of poolRef.current) p.active = false;
        activeRef.current = 0;
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        const ctx = canvasRef.current?.getContext("2d");
        ctx?.clearRect(0, 0, window.innerWidth, window.innerHeight);
      },
    }));

    function start() {
      if (rafRef.current !== null) return;

      const step = () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!ctx) {
          rafRef.current = null;
          return;
        }

        const width = window.innerWidth;
        const height = window.innerHeight;
        ctx.clearRect(0, 0, width, height);

        let live = 0;
        for (const p of poolRef.current) {
          if (!p.active) continue;

          p.vy += 0.09;
          p.vx *= 0.995;
          p.x += p.vx;
          p.y += p.vy;
          p.rotation += p.spin;
          if (p.y > height * 0.72) p.life -= 0.018;

          if (p.life <= 0 || p.y > height + 60) {
            p.active = false;
            continue;
          }
          live++;

          ctx.save();
          ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.fillStyle = COLORS[p.hue];
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();
        }

        activeRef.current = live;
        if (live === 0) {
          rafRef.current = null;
          return;
        }
        rafRef.current = requestAnimationFrame(step);
      };

      rafRef.current = requestAnimationFrame(step);
    }

    return (
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none fixed inset-0 z-40"
      />
    );
  },
);
