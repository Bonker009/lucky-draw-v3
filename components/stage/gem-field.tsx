"use client";

import { useMemo, type CSSProperties } from "react";
import type { Quality } from "@/lib/hooks/use-frame-budget";
import {
  KEEP_OUT,
  REF_H,
  REF_W,
  layoutGems,
  type GemKind,
  type KeepOut,
} from "@/lib/stage/gem-layout";

/*
 * Floating low-poly gems and sparkles around the edges of the stage.
 *
 * Decoration under everything, so it follows the stage's rules:
 *
 * - Cool tones only. On the projector warm gold means "winner"; a gold gem
 *   beside a gold winner's name would make both read as equally important.
 * - Edges and corners only (`KEEP_OUT` in `lib/stage/gem-layout.ts`), and at
 *   reduced strength: names have to win against it.
 * - Cheap: a handful of SVGs whose motion is CSS transform and opacity, so it
 *   runs on the compositor. At `minimal` quality it is not drawn at all, at
 *   `reduced` it drops the glow and half the sparkles; under reduced motion it
 *   holds still (the classes are in the motion opt-out list in globals.css).
 * - Each view passes its own seed, so the draw and the photo session have
 *   different arrangements, each stable for as long as the page is open.
 */

/** Facets as [points, shade]; shade 0 is the lit face, 4 the darkest. */
const FACETS: Partial<Record<GemKind, [string, number][]>> = {
  hero: [["82,16 54,58 76,86", 2], ["54,58 26,126 76,86", 3], ["82,16 154,22 138,44", 1], ["154,22 174,56 138,44", 3], ["82,16 76,86 156,112", 0], ["82,16 138,44 156,112", 1], ["138,44 174,56 178,108 156,112", 2], ["26,126 76,86 118,190", 1], ["76,86 118,190 136,184", 4], ["76,86 156,112 178,108 158,168 136,184", 2], ["136,184 158,168 144,188", 4]],
  shard: [["98,16 135,50 122,58", 0], ["98,16 122,58 84,96 44,68", 1], ["135,50 148,136 126,134 122,58", 1], ["122,58 126,134 84,96", 2], ["44,68 84,96 34,112", 3], ["84,96 126,134 132,168 76,144", 3], ["34,112 84,96 76,144 72,172", 4], ["76,144 132,168 108,184 72,172", 3], ["126,134 148,136 132,168", 1]],
  tourmaline: [["56,22 146,28 124,54 30,48", 0], ["146,28 176,120 156,154 124,54", 3], ["30,48 124,54 96,156 18,144", 1], ["124,54 156,154 96,156", 2], ["30,48 42,118 18,144", 4], ["18,144 96,156 66,184", 4], ["96,156 156,154 66,184", 3]],
  tanzanite: [["48,38 92,16 106,66 24,68", 0], ["92,16 158,64 106,66", 2], ["24,68 106,66 108,116 48,112", 1], ["106,66 158,64 146,158 108,116", 4], ["48,112 108,116 106,182 60,188 30,136", 2], ["108,116 146,158 106,182", 3]],
  amethyst: [["52,42 108,32 134,76 88,78", 0], ["108,32 164,84 134,76", 1], ["28,60 52,42 88,78", 3], ["28,60 88,78 78,176 44,142", 2], ["88,78 134,76 128,154 78,176", 4], ["134,76 164,84 128,154", 1]],
  garnet: [["62,38 110,24 162,56 76,56", 0], ["62,38 76,56 42,126 20,124 44,58", 1], ["76,56 162,56 134,146 42,126", 1], ["162,56 186,104 146,168 134,146", 3], ["42,126 134,146 146,168 50,174", 2], ["20,124 42,126 50,174", 4]],
};

/** Outline-only gems. */
const WIRES: Partial<Record<GemKind, string>> = {
  wire: "M100,16 L168,68 L144,158 L100,186 L56,158 L32,68 Z M100,44 L134,72 L100,104 L66,72 Z M100,16 L100,44 M168,68 L134,72 M32,68 L66,72 M100,104 L100,186 M134,72 L144,158 M66,72 L56,158",
  wire2: "M104,14 L164,74 L148,162 L112,182 L62,192 L38,144 L30,72 L56,36 Z M56,36 L104,14 L118,66 L30,72 M118,66 L164,74 M30,72 L68,112 L118,118 L164,74 M118,66 L118,118 M68,112 L62,192 M118,118 L112,182 M68,112 L38,144",
};

const GLINT: Partial<Record<GemKind, [number, number]>> = {
  hero: [116, 108],
  shard: [115, 62],
  tourmaline: [122, 62],
  tanzanite: [96, 74],
  amethyst: [128, 78],
  garnet: [88, 76],
};

/** Smoked indigo, violet, steel and muted rose — light to dark. */
const FAMILIES = [
  ["#c7cfff", "#8b95f0", "#5f5cc0", "#3a3478", "#201c44"],
  ["#e2c6ff", "#ab87ec", "#7853b8", "#4b3478", "#291c44"],
  ["#d4e6f8", "#94b2d4", "#627ca4", "#3d506e", "#212a3e"],
  ["#f6c4d6", "#cc86a4", "#965678", "#603656", "#342240"],
];
const GLOW = [
  "rgb(139 149 240 / 0.55)",
  "rgb(171 135 236 / 0.55)",
  "rgb(148 178 212 / 0.5)",
  "rgb(204 134 164 / 0.5)",
];
const SPARK_TONES = ["#eef1ff", "#e2d6ff", "#d6e8f8", "#ffffff", "#f6dbe6"];

const toPath = (pts: string) => `M${pts.split(" ").join(" L")} Z`;

function shadePaths(kind: GemKind) {
  const d = ["", "", "", "", ""];
  for (const [pts, shade] of FACETS[kind] ?? []) d[shade] += `${toPath(pts)} `;
  return d;
}

const pct = (v: number, of: number) => `${(v / of) * 100}%`;
/** Sizes follow the screen's height, so gems keep their shape on any aspect. */
const vh = (v: number) => `${(v / REF_H) * 100}vh`;

export function GemField({
  seed,
  strength = 0.5,
  keepOut = KEEP_OUT,
  quality,
}: {
  seed: string;
  /** Overall opacity, 0–1. Low where names fill the screen. */
  strength?: number;
  /** Where no gem may sit, in the 1920×1080 reference frame. */
  keepOut?: KeepOut;
  quality: Quality;
}) {
  const layout = useMemo(() => layoutGems(seed, keepOut), [seed, keepOut]);
  if (quality === "minimal") return null;
  const rich = quality === "full";
  const sparks = rich ? layout.sparks : layout.sparks.filter((_, i) => i % 2 === 0);
  const sparkPeak = Math.min(1, 0.45 + strength * 0.6);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {layout.gems.map((g, i) => {
        const shades = FAMILIES[g.family];
        const d = shadePaths(g.kind);
        const glint = GLINT[g.kind];
        return (
          <div
            key={i}
            className="gem-float absolute"
            style={
              {
                left: pct(g.x, REF_W),
                top: pct(g.y, REF_H),
                width: vh(g.size),
                height: vh(g.size),
                opacity: strength,
                "--gem-amp": vh(g.amp),
                animationDuration: `${g.durationMs}ms`,
                animationDelay: `${g.delayMs}ms`,
              } as CSSProperties
            }
          >
            <svg
              viewBox="0 0 200 200"
              className="size-full overflow-visible"
              style={{
                transform: `rotate(${g.rotate}deg)`,
                filter: rich
                  ? `drop-shadow(0 0 22px ${GLOW[g.family]}) drop-shadow(0 10px 30px rgb(0 0 0 / 0.5))`
                  : undefined,
              }}
            >
              {[4, 3, 2, 1, 0].map((k) =>
                d[k] ? <path key={k} d={d[k]} fill={shades[k]} /> : null,
              )}
              {WIRES[g.kind] ? (
                <path
                  d={WIRES[g.kind]}
                  fill="none"
                  stroke={shades[0]}
                  strokeWidth={2.3}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ) : null}
              {glint ? (
                <g transform={`translate(${glint[0]} ${glint[1]})`}>
                  <g className="gem-glint" style={{ animationDelay: `${g.delayMs}ms` }}>
                    <path d="M-15 0H15M0 -15V15" stroke="#fff" strokeWidth={1.2} strokeLinecap="round" />
                    <path d="M0,-6.5 L1.6,-1.6 L6.5,0 L1.6,1.6 L0,6.5 L-1.6,1.6 L-6.5,0 L-1.6,-1.6 Z" fill="#fff" />
                    <circle r={2.4} fill="#fff" opacity={0.9} />
                  </g>
                </g>
              ) : null}
            </svg>
          </div>
        );
      })}

      {sparks.map((s, i) => {
        const tone = SPARK_TONES[s.tone % SPARK_TONES.length];
        return (
          <div
            key={`s${i}`}
            className="gem-spark absolute"
            style={
              {
                left: pct(s.x, REF_W),
                top: pct(s.y, REF_H),
                width: vh(s.size),
                height: vh(s.size),
                "--spark-peak": sparkPeak,
                animationDuration: `${s.durationMs}ms`,
                animationDelay: `${s.delayMs}ms`,
              } as CSSProperties
            }
          >
            <svg
              viewBox="-12 -12 24 24"
              className="size-full overflow-visible"
              style={rich ? { filter: `drop-shadow(0 0 4px ${tone})` } : undefined}
            >
              <path d="M-11 0H11M0 -11V11" stroke={tone} strokeWidth={1.2} strokeLinecap="round" />
              <path d="M0,-7 L1.8,-1.8 L7,0 L1.8,1.8 L0,7 L-1.8,1.8 L-7,0 L-1.8,-1.8 Z" fill="#fff" />
            </svg>
          </div>
        );
      })}
    </div>
  );
}
