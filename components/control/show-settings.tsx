"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TIMING_LIMITS, type Channel, type LiveSettings } from "@/lib/channel";
import type { Settings } from "@/lib/domain/types";

const STEP_MS = 500;
/** Clicks inside this window are sent as one change. */
const SETTLE_MS = 350;
/** How long the local value is trusted before the stage's echo takes over. */
const ECHO_MS = 800;

/**
 * Pace and feel of the draw, adjustable mid-show.
 *
 * Typed values with ± nudges, not sliders: every change is an event in the
 * log, and a slider drag would write dozens of them. There is no ceiling —
 * the operator knows their run-of-show. Rapid clicks are batched locally and sent
 * as one `cmd:patchSettings`; the stage validates and commits it, and the
 * committed value comes back through the normal broadcast.
 */
export function ShowSettings({
  channel,
  settings,
  disabled,
}: {
  channel: Channel;
  settings: Settings;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState<Partial<LiveSettings>>({});
  const pending = useRef<Partial<LiveSettings>>({});
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (sendTimer.current) clearTimeout(sendTimer.current);
      if (clearTimer.current) clearTimeout(clearTimer.current);
    },
    [],
  );

  const value = { ...settings, ...draft };

  function change(patch: Partial<LiveSettings>) {
    pending.current = { ...pending.current, ...patch };
    setDraft((d) => ({ ...d, ...patch }));
    if (sendTimer.current) clearTimeout(sendTimer.current);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    sendTimer.current = setTimeout(() => {
      channel.post({ kind: "cmd:patchSettings", patch: pending.current });
      pending.current = {};
      // Hand the display back to the committed value once the stage has had
      // time to echo it. If it never does (stage gone), the truth shows.
      clearTimer.current = setTimeout(() => setDraft({}), ECHO_MS);
    }, SETTLE_MS);
  }

  return (
    <section
      aria-label="Show settings"
      title="Applies from the next draw. A batch already running keeps its pace."
      className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-card px-4 py-2"
    >
      <TimeStepper
        label="Spin"
        value={value.spinDurationMs}
        limits={TIMING_LIMITS.spinDurationMs}
        disabled={disabled}
        onChange={(spinDurationMs) => change({ spinDurationMs })}
      />
      <TimeStepper
        label="Hold"
        value={value.revealHoldMs}
        limits={TIMING_LIMITS.revealHoldMs}
        disabled={disabled}
        onChange={(revealHoldMs) => change({ revealHoldMs })}
      />
      <Toggle
        id="live-suspense"
        label="Suspense"
        hint="The last few winners of a prize spin longer"
        checked={value.suspenseScaling}
        disabled={disabled}
        onChange={(suspenseScaling) => change({ suspenseScaling })}
      />
      <Toggle
        id="live-reduced-motion"
        label="Reduced motion"
        hint="Short spins, no blur. For a struggling laptop or a sensitive room"
        checked={value.reducedMotionOverride}
        disabled={disabled}
        onChange={(reducedMotionOverride) => change({ reducedMotionOverride })}
      />
      <Toggle
        id="live-winners-rail"
        label="Winners list"
        hint="Show or hide the winners list beside the stage. W on the stage does the same"
        checked={value.showWinnersRail ?? true}
        disabled={disabled}
        onChange={(showWinnersRail) => change({ showWinnersRail })}
      />
    </section>
  );
}

function TimeStepper({
  label,
  value,
  limits,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  limits: { min: number };
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  // What the operator is typing, until they commit it. null = show the value.
  const [text, setText] = useState<string | null>(null);
  const floor = (n: number) => Math.max(limits.min, Math.round(n));
  const seconds = (value / 1000).toFixed(1);

  function commitText() {
    if (text === null) return;
    const n = Number.parseFloat(text.replace(",", "."));
    setText(null);
    if (Number.isFinite(n) && n >= 0) onChange(floor(n * 1000));
  }

  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor={`live-${label.toLowerCase()}`}
        className="ui-eyebrow text-muted-foreground"
      >
        {label}
      </label>
      <div className="flex items-center rounded-lg border border-border p-0.5">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Shorter ${label.toLowerCase()}`}
          disabled={disabled || value <= limits.min}
          onClick={() => onChange(floor(value - STEP_MS))}
        >
          <Minus />
        </Button>
        <span className="flex items-baseline">
          <input
            id={`live-${label.toLowerCase()}`}
            type="text"
            inputMode="decimal"
            disabled={disabled}
            value={text ?? seconds}
            onFocus={(e) => {
              setText(seconds);
              e.currentTarget.select();
            }}
            onChange={(e) => setText(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setText(null);
                e.currentTarget.blur();
              }
            }}
            aria-label={`${label} in seconds`}
            className="w-10 bg-transparent text-right font-mono text-xs tabular-nums text-foreground outline-none focus:rounded focus:bg-muted disabled:opacity-50"
          />
          <span aria-hidden className="pr-1 font-mono text-xs text-muted-foreground">
            s
          </span>
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Longer ${label.toLowerCase()}`}
          disabled={disabled}
          onClick={() => onChange(floor(value + STEP_MS))}
        >
          <Plus />
        </Button>
      </div>
    </div>
  );
}

function Toggle({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      title={hint}
      className="flex cursor-pointer items-center gap-2 text-xs text-foreground/80"
    >
      <Switch
        id={id}
        size="sm"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
      {label}
    </label>
  );
}
