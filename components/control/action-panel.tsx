"use client";

import { useEffect, useState } from "react";
import { Eraser, Minus, Play, Plus, SkipForward, Square, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShimmerButton } from "@/components/ui/shimmer-button";

/** Quick counts. Anything else goes through the stepper. */
const PRESETS = [1, 3, 5, 10];

/** How long the armed Undo waits for its second press. */
const UNDO_ARM_MS = 3000;

const SHORTCUTS: [string, string][] = [
  ["Space", "Draw"],
  ["S", "Stop"],
  ["N", "Next"],
  ["Esc", "Clear"],
  ["↑↓", "Count"],
];

/**
 * Draw/Stop and everything that sits under the operator's thumb.
 *
 * Undo is a two-press button rather than `window.confirm()`: a native dialog
 * blocks the whole tab, and a remote frozen behind a modal mid-show is worse
 * than the mistake it guards against.
 */
export function ActionPanel({
  count,
  remaining,
  onCount,
  prizeName,
  canDraw,
  canStop,
  busy,
  onDraw,
  onStop,
  onClear,
  onNext,
  onUndo,
}: {
  /** Already clamped to what the selected prize has left. */
  count: number;
  remaining: number;
  onCount: (n: number) => void;
  prizeName: string | undefined;
  canDraw: boolean;
  canStop: boolean;
  busy: boolean;
  onDraw: () => void;
  onStop: () => void;
  onClear: () => void;
  onNext: () => void;
  onUndo: () => void;
}) {
  const [undoArmed, setUndoArmed] = useState(false);

  useEffect(() => {
    if (!undoArmed) return;
    const t = setTimeout(() => setUndoArmed(false), UNDO_ARM_MS);
    return () => clearTimeout(t);
  }, [undoArmed]);

  return (
    <section
      aria-label="Draw controls"
      className="flex flex-col gap-2.5 rounded-t-2xl border-t border-border bg-card px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.35)] lg:rounded-2xl lg:border lg:pb-4 lg:shadow-none"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* The label is dropped on a phone so the whole count row fits on
            one line and the pinned bar stays short. */}
        <span className="ui-eyebrow hidden text-muted-foreground sm:inline">
          How many
        </span>

        <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="One fewer"
            disabled={count <= 1}
            onClick={() => onCount(count - 1)}
          >
            <Minus />
          </Button>
          <span className="w-8 text-center text-sm font-semibold tabular-nums text-foreground">
            {count}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="One more"
            disabled={count >= remaining}
            onClick={() => onCount(count + 1)}
          >
            <Plus />
          </Button>
        </div>

        <div className="flex flex-wrap gap-0.5">
          {PRESETS.filter((n) => n <= remaining && n !== remaining).map((n) => (
            <Button
              key={n}
              variant={count === n ? "secondary" : "ghost"}
              size="sm"
              onClick={() => onCount(n)}
            >
              {n}
            </Button>
          ))}
          <Button
            variant={count === remaining && remaining > 0 ? "secondary" : "ghost"}
            size="sm"
            disabled={remaining === 0}
            onClick={() => onCount(remaining)}
          >
            All {remaining}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {/* The one button that matters, so it carries a slow sheen while it
            is ready to press. Ink, not gold — gold means "winner" — and the
            sheen stops while a draw runs or the stage is gone, so a moving
            button never competes with the show. */}
        <ShimmerButton
          type="button"
          disabled={!canDraw}
          onClick={onDraw}
          background="var(--primary)"
          shimmerColor={canDraw && !busy ? "var(--primary-foreground)" : "transparent"}
          shimmerDuration="3.2s"
          // Literal: the button scopes its own `--radius`, and a value built
          // from the theme's `--radius` would then reference itself.
          borderRadius="10px"
          className="col-span-2 h-14 flex-col gap-0 border-transparent px-4 py-0 text-lg font-medium text-primary-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          <span className="flex items-center gap-2">
            <Play className="size-5" />
            Draw
          </span>
          {prizeName && remaining > 0 ? (
            <span
              aria-hidden
              className="max-w-full truncate text-xs font-normal opacity-75"
            >
              ×{count} · {prizeName}
            </span>
          ) : null}
        </ShimmerButton>
        <Button
          variant="destructive"
          size="lg"
          disabled={!canStop}
          onClick={onStop}
          className="h-14 bg-destructive text-lg text-destructive-foreground hover:bg-destructive/90"
        >
          <Square className="size-5" />
          Stop
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Button
          variant="outline"
          disabled={busy}
          onClick={onClear}
          title="Clear the winner off the projector"
        >
          <Eraser />
          Clear
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={onNext}
          title="Move the stage to the next prize with stock left"
        >
          <SkipForward />
          Next prize
        </Button>
        <Button
          variant={undoArmed ? "destructive" : "outline"}
          disabled={busy}
          onClick={() => {
            if (!undoArmed) {
              setUndoArmed(true);
              return;
            }
            setUndoArmed(false);
            onUndo();
          }}
        >
          <Undo2 />
          {undoArmed ? "Confirm undo" : "Undo last"}
        </Button>
      </div>

      <ul
        aria-label="Keyboard shortcuts"
        className="hidden flex-nowrap gap-x-2.5 overflow-hidden text-[0.7rem] whitespace-nowrap text-muted-foreground lg:flex"
      >
        {SHORTCUTS.map(([key, label]) => (
          <li key={key} className="flex items-center gap-1">
            <kbd className="rounded border border-border bg-muted px-1 py-px font-mono text-[0.65rem] text-foreground/80">
              {key}
            </kbd>
            {label}
          </li>
        ))}
      </ul>
    </section>
  );
}
