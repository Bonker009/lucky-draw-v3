"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * v2 had no error boundary anywhere: one thrown render error meant a white
 * screen on the projector. This keeps something dignified on screen and gives
 * the operator a way back without losing the log, which lives in IndexedDB.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Lucky draw crashed:", error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-base-900 px-8 text-center">
      <p className="stage-label text-gold">Lucky Draw</p>
      <h1 className="text-3xl font-semibold text-ink-100">
        Something went wrong on this screen
      </h1>
      <p className="max-w-md text-ink-300">
        Every winner drawn so far is saved. Recovering will replay the event
        exactly as it stands.
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-gold px-6 py-3 font-medium text-base-900"
        >
          Recover
        </button>
        <Link
          href="/"
          className="rounded-lg border border-base-600 px-6 py-3 text-ink-100"
        >
          Setup
        </Link>
      </div>
      {error.digest ? (
        <p className="font-mono text-xs text-ink-500">{error.digest}</p>
      ) : null}
    </main>
  );
}
