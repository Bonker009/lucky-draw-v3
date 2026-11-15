"use client";

import type { Quality } from "@/lib/hooks/use-frame-budget";

/**
 * Three transform-animated gradient layers, and an optional photo.
 *
 * v2 rendered 56 individually animated SVG shapes, four full-viewport pattern
 * rects and three 500-800px blurred orbs, then put backdrop-blur-3xl on top of
 * the lot. This is the same sense of depth for roughly none of the GPU cost.
 */
export function Backdrop({
  imageUrl,
  quality,
}: {
  imageUrl?: string | null;
  quality: Quality;
}) {
  const animate = quality === "full";

  return (
    <div
      aria-hidden
      className="stage-bg pointer-events-none absolute inset-0 overflow-hidden"
    >
      {imageUrl ? (
        // 0.28, not 0.45. People upload busy photos, and at the old opacity
        // the artwork read through the reel and fought the names for
        // attention in the exact centre of the screen.
        <div
          className="absolute inset-0 bg-cover bg-center opacity-[0.28]"
          // Not background-attachment: fixed — that forces a full repaint on
          // every scroll and resize.
          style={{ backgroundImage: `url(${imageUrl})` }}
        />
      ) : null}

      <div
        className={`backdrop-layer ${animate ? "drift-a" : ""}`}
        style={{
          background:
            "radial-gradient(closest-side, rgb(255 255 255 / 0.035), transparent 70%)",
          left: "-20%",
          top: "-35%",
          width: "80%",
          height: "90%",
        }}
      />
      <div
        className={`backdrop-layer ${animate ? "drift-b" : ""}`}
        style={{
          background:
            "radial-gradient(closest-side, rgb(255 255 255 / 0.025), transparent 70%)",
          right: "-25%",
          bottom: "-30%",
          left: "auto",
          top: "auto",
          width: "75%",
          height: "85%",
        }}
      />
      {quality !== "minimal" ? (
        <div
          className={`backdrop-layer ${animate ? "drift-a" : ""}`}
          style={{
            background:
              "radial-gradient(closest-side, rgb(242 214 138 / 0.04), transparent 70%)",
            left: "30%",
            top: "20%",
            width: "60%",
            height: "70%",
            animationDelay: "-12s",
          }}
        />
      ) : null}

      {/* A fixed vignette keeps the eye on the centre of a large screen. Deep
          navy, not black: a near-black rim read as a hole cut in the gradient. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 45%, rgb(12 14 36 / 0.6) 100%)",
        }}
      />
    </div>
  );
}
