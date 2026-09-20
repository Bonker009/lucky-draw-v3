"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Camera,
  CameraOff,
  Eraser,
  ExternalLink,
  Minus,
  Play,
  Plus,
  Settings2,
  SkipForward,
  Square,
  Undo2,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  awardedFor,
  eventStats,
  nextAvailablePrize,
  orderedPrizes,
  remainingFor,
} from "@/lib/domain/selectors";
import { ROSTER_ALL } from "@/components/stage/photo-call";
import { getChannel, type ChannelMessage } from "@/lib/channel";
import { useEventStore } from "@/lib/store/event-store";

interface Mirror {
  phase: string;
  revealed: string | null;
  pending: number;
  prizeId?: string;
  /** Which photo-call board the stage currently has up, if any. */
  roster: string | null;
  seenAt: number;
}

/** Quick counts. Anything else goes through the stepper. */
const PRESETS = [1, 3, 5, 10];

const PHASE_COPY: Record<string, string> = {
  idle: "Ready",
  spinning: "Spinning",
  revealing: "Revealing",
  celebrating: "Celebrating",
  stopped: "Stopped",
};

/**
 * The presenter remote.
 *
 * It never writes. It posts commands to the stage, which owns the log, and
 * mirrors back what the projector is actually showing. That asymmetry is the
 * point: v2 let the admin page write the same records as the display page.
 *
 * Laid out for how it is actually used: glanced at in a dark room, one hand,
 * while talking to an audience. What the stage is doing sits at the top at
 * reading distance, and Draw/Stop are pinned to the bottom so they never
 * scroll out from under the operator mid-show.
 */
export default function ControlPage() {
  const { state, ready, load, applyRemote } = useEventStore();
  const [mirror, setMirror] = useState<Mirror | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [count, setCount] = useState(1);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const unsubscribe = getChannel().subscribe((message: ChannelMessage) => {
      if (message.kind === "evt:phase") {
        setMirror({
          phase: message.phase,
          revealed: message.revealed ?? null,
          pending: message.pending,
          prizeId: message.prizeId,
          roster: message.roster ?? null,
          seenAt: Date.now(),
        });
      } else if (message.kind === "evt:committed") {
        applyRemote(message.events);
      } else if (message.kind === "evt:reloaded") {
        void load();
      }
    });
    // Ask the stage where it is; it may have been open long before us.
    getChannel().post({ kind: "cmd:requestSnapshot" });
    const retry = setInterval(() => {
      getChannel().post({ kind: "cmd:requestSnapshot" });
    }, 2000);

    return () => {
      unsubscribe();
      clearInterval(retry);
    };
  }, [applyRemote, load]);

  const channel = getChannel();
  const prizes = orderedPrizes(state);
  // Follow whatever the stage says it is showing until the operator picks.
  // The fallback skips fully-awarded prizes: defaulting to prizes[0] parked
  // the remote on an exhausted prize with Draw greyed out, which reads as a
  // broken remote rather than a finished prize.
  const selected =
    pinned ?? mirror?.prizeId ?? nextAvailablePrize(state)?.id ?? prizes[0]?.id ?? null;
  const stats = eventStats(state);
  const remaining = selected ? remainingFor(state, selected) : 0;
  const busy = mirror?.phase === "spinning" || mirror?.phase === "revealing";
  const stageConnected = mirror !== null;
  const selectedPrize = selected ? state.prizesById.get(selected) : undefined;

  const rosterUp = mirror?.roster ?? null;
  const awardedHere = selected ? awardedFor(state, selected) : 0;

  const revealedName = mirror?.revealed
    ? (state.participantsById.get(mirror.revealed)?.name ?? mirror.revealed)
    : null;

  const canDraw =
    !busy && !!selected && remaining > 0 && stageConnected;

  if (!ready) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-muted-foreground">
        <p className="ui-eyebrow">Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex h-dvh w-full max-w-4xl flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-4 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <p className="ui-eyebrow text-muted-foreground">Control</p>
          <h1 className="truncate text-lg font-semibold text-foreground">
            {state.settings.eventName}
          </h1>
        </div>

        <Badge
          variant="outline"
          className={
            stageConnected
              ? "border-gold-ui/40 bg-gold-ui/10 text-gold-ui-strong"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          }
        >
          <span
            aria-hidden
            className={`size-1.5 rounded-full ${
              stageConnected ? "bg-gold-ui" : "bg-destructive"
            } ${busy ? "pulse-soft" : ""}`}
          />
          {stageConnected ? "Stage linked" : "No stage"}
        </Badge>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm">
            <Link href="/">
              <Settings2 />
              Setup
            </Link>
          </Button>
        </div>
      </header>

      {/* What the projector is showing right now. The single most important
          thing on this screen, so it gets the top slot and the big type. */}
      <section className="shrink-0 px-5 py-4">
        {stageConnected ? (
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="ui-eyebrow text-muted-foreground">
                {PHASE_COPY[mirror.phase] ?? mirror.phase}
              </p>
              {mirror.pending > 0 ? (
                <p className="text-xs tabular-nums text-muted-foreground">
                  {mirror.pending} to go
                </p>
              ) : null}
            </div>
            <p
              className={`mt-1 truncate text-2xl font-semibold ${
                revealedName
                  ? "text-gold-ui-strong"
                  : "text-muted-foreground/70"
              }`}
            >
              {revealedName ?? "Nothing on screen"}
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="ui-eyebrow text-destructive">No stage window</p>
            <p className="mt-1 text-sm text-foreground/75">
              Open the stage on the projector screen — this remote has nothing
              to drive until then.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-3">
              <a href="/stage" target="_blank" rel="noreferrer">
                <ExternalLink />
                Open /stage
              </a>
            </Button>
          </div>
        )}
      </section>

      {/* Prizes take the flexible middle: it is the only list that can grow. */}
      <section className="flex min-h-0 flex-1 flex-col px-5 pb-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="ui-eyebrow text-muted-foreground">Prize</h2>
          <p className="text-xs tabular-nums text-muted-foreground">
            {stats.awarded} awarded · {stats.remaining} slots left ·{" "}
            {stats.eligible} eligible
          </p>
        </div>

        <ScrollArea className="min-h-0 flex-1 rounded-xl border border-border">
          <ul className="divide-y divide-border">
            {prizes.map((prize) => {
              const left = remainingFor(state, prize.id);
              const awarded = awardedFor(state, prize.id);
              const isSelected = prize.id === selected;
              const done = prize.quantity > 0 ? (awarded / prize.quantity) * 100 : 0;
              return (
                <li key={prize.id}>
                  <button
                    type="button"
                    disabled={busy}
                    aria-pressed={isSelected}
                    onClick={() => {
                      setPinned(prize.id);
                      setCount(1);
                      channel.post({
                        kind: "cmd:selectPrize",
                        prizeId: prize.id,
                      });
                    }}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors disabled:opacity-50 ${
                      isSelected
                        ? "bg-gold-ui/10"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    {/* Selection marker. A left rail rather than a full border,
                        so switching prizes does not shift the row. */}
                    <span
                      aria-hidden
                      className={`h-9 w-1 shrink-0 rounded-full ${
                        isSelected ? "bg-gold-ui" : "bg-transparent"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate font-medium ${
                          isSelected ? "text-foreground" : "text-foreground/75"
                        }`}
                      >
                        {prize.name}
                      </p>
                      <Progress
                        value={done}
                        className="mt-1.5 h-1 bg-muted [&>*]:bg-gold-ui"
                      />
                    </div>
                    <span
                      className={`shrink-0 text-sm tabular-nums ${
                        left === 0
                          ? "text-muted-foreground"
                          : "text-gold-ui-strong"
                      }`}
                    >
                      {left} left
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      </section>

      {/* Pinned to the bottom. During a show the operator's thumb lives here. */}
      <section className="shrink-0 border-t border-border bg-card/60 px-5 py-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">How many</span>

          <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="One fewer"
              disabled={count <= 1}
              onClick={() => setCount((n) => Math.max(1, n - 1))}
            >
              <Minus />
            </Button>
            <span className="w-8 text-center text-sm font-medium tabular-nums text-foreground">
              {Math.min(count, Math.max(1, remaining))}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="One more"
              disabled={count >= remaining}
              onClick={() => setCount((n) => Math.min(remaining, n + 1))}
            >
              <Plus />
            </Button>
          </div>

          {PRESETS.filter((n) => n <= remaining).map((n) => (
            <Button
              key={n}
              variant={count === n ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setCount(n)}
            >
              {n}
            </Button>
          ))}
          <Button
            variant={count === remaining && remaining > 0 ? "secondary" : "ghost"}
            size="sm"
            disabled={remaining === 0}
            onClick={() => setCount(remaining)}
          >
            All {remaining}
          </Button>

          {selectedPrize ? (
            <span className="ml-auto truncate text-xs text-muted-foreground">
              into {selectedPrize.name}
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Button
            size="lg"
            disabled={!canDraw}
            onClick={() => {
              if (!selected) return;
              channel.post({
                kind: "cmd:draw",
                prizeId: selected,
                count: Math.min(count, remaining),
              });
            }}
            className="col-span-2 h-16 text-lg"
          >
            <Play className="size-5" />
            Draw
          </Button>
          <Button
            variant="destructive"
            size="lg"
            onClick={() => channel.post({ kind: "cmd:stop" })}
            className="h-16 bg-destructive text-lg text-destructive-foreground hover:bg-destructive/90"
          >
            <Square className="size-5" />
            Stop
          </Button>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => channel.post({ kind: "cmd:dismissWinner" })}
          >
            <Eraser />
            Clear screen
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => channel.post({ kind: "cmd:nextPrize" })}
          >
            <SkipForward />
            Next prize
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              if (confirm("Undo the most recent winner?")) {
                channel.post({ kind: "cmd:undo" });
              }
            }}
          >
            <Undo2 />
            Undo last
          </Button>
        </div>
      </section>

      {/* Photo session ----------------------------------------------------
          Events shoot a group photo per prize, so the projector needs every
          winner of that prize up at once for people to find themselves and
          come to the stage. */}
      <section
        aria-label="Photo session"
        className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="ui-eyebrow text-muted-foreground">Photo session</h2>
          {rosterUp ? (
            <Badge
              variant="outline"
              className="border-gold-ui/50 text-gold-ui-strong"
            >
              On screen
            </Badge>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            disabled={busy || !selected || awardedHere === 0}
            onClick={() =>
              selected && channel.post({ kind: "cmd:showRoster", scope: selected })
            }
          >
            <Camera />
            {selectedPrize
              ? `${selectedPrize.name} (${awardedHere})`
              : "This prize"}
          </Button>
          <Button
            variant="outline"
            disabled={busy || stats.awarded === 0}
            onClick={() =>
              channel.post({ kind: "cmd:showRoster", scope: ROSTER_ALL })
            }
          >
            <Camera />
            All winners ({stats.awarded})
          </Button>
        </div>

        <Button
          variant={rosterUp ? "secondary" : "ghost"}
          disabled={!rosterUp}
          onClick={() => channel.post({ kind: "cmd:hideRoster" })}
        >
          <CameraOff />
          Back to the draw
        </Button>

        <p className="text-xs text-muted-foreground">
          Puts every winner of that prize on the projector, numbered, so the
          group can be called up and checked before the photo.
        </p>
      </section>
    </main>
  );
}
