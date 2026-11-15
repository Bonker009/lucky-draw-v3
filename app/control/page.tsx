"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Settings2, Volume2, VolumeX } from "lucide-react";
import { ActionPanel } from "@/components/control/action-panel";
import { NowOnStage } from "@/components/control/now-on-stage";
import { PhotoCheckIn } from "@/components/control/photo-check-in";
import { PhotoSession } from "@/components/control/photo-session";
import { PrizeList } from "@/components/control/prize-list";
import { PrizeRevealControls } from "@/components/control/prize-reveal-controls";
import { ShowSettings } from "@/components/control/show-settings";
import { WinnersList } from "@/components/control/winners-list";
import { ROSTER_ALL } from "@/components/stage/photo-call";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  awardedFor,
  eventStats,
  nextAvailablePrize,
  orderedPrizes,
  participantName,
  remainingFor,
} from "@/lib/domain/selectors";
import { getChannel } from "@/lib/channel";
import type { DrawState } from "@/lib/domain/types";
import { useStageMirror } from "@/lib/hooks/use-stage-mirror";
import {
  clampGroup,
  groupCount,
  groupSlice,
  photoRoster,
} from "@/lib/stage/photo-session";
import { useEventStore } from "@/lib/store/event-store";

const LINK_BADGE = {
  linked: {
    label: "Stage linked",
    className: "border-border bg-card text-foreground",
    dot: "bg-emerald-500",
  },
  lost: {
    label: "Stage lost",
    className:
      "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500 pulse-soft",
  },
  none: {
    label: "No stage",
    className: "border-destructive/40 bg-destructive/10 text-destructive",
    dot: "bg-destructive",
  },
} as const;

/**
 * The state as the audience has seen it: the first `shown` winners of the log.
 *
 * The stage commits a winner before it spins towards them, so the log is one
 * name ahead of the drum for the whole spin. The remote used to print that
 * name the instant Draw was pressed — on a laptop the room can often see.
 * Display only: commands still read the real state.
 */
function revealedView(state: DrawState, shown: number): DrawState {
  if (shown >= state.winners.length) return state;
  const awardedByPrize = new Map(state.awardedByPrize);
  const winnerByParticipant = new Map(state.winnerByParticipant);
  for (const w of state.winners.slice(shown)) {
    awardedByPrize.set(w.prizeId, Math.max(0, (awardedByPrize.get(w.prizeId) ?? 0) - 1));
    winnerByParticipant.delete(w.participantId);
  }
  return {
    ...state,
    winners: state.winners.slice(0, shown),
    awardedByPrize,
    winnerByParticipant,
  };
}

/** Keys the remote answers to. Anything typed into a field is left alone. */
function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

/**
 * The presenter remote.
 *
 * It never writes. It posts commands to the stage, which owns the log, and
 * mirrors back what the projector is actually showing. That asymmetry is the
 * point: v2 let the admin page write the same records as the display page.
 *
 * Laid out for how it is actually used: glanced at in a dark room, often one
 * hand, while talking to an audience. On a laptop it is a two-column console
 * that never scrolls; on a phone it is one column with Draw/Stop pinned under
 * the thumb. Both are the same DOM — the phone layout just moves the action
 * panel last and makes it sticky — so there is only one Draw button to reason
 * about.
 */
export default function ControlPage() {
  const { state, ready, load } = useEventStore();
  const { mirror, link, now } = useStageMirror();
  const [pinned, setPinned] = useState<string | null>(null);
  const [count, setCount] = useState(1);

  useEffect(() => {
    void load();
  }, [load]);

  const channel = getChannel();
  const prizes = orderedPrizes(state);
  // Follow whatever the stage says it is showing until the operator picks.
  // The fallback skips fully-awarded prizes: defaulting to prizes[0] parked
  // the remote on an exhausted prize with Draw greyed out, which reads as a
  // broken remote rather than a finished prize.
  const selected =
    pinned ?? mirror?.prizeId ?? nextAvailablePrize(state)?.id ?? prizes[0]?.id ?? null;
  const linked = link === "linked";
  // Everything the operator *reads* goes through `view`; only commands use
  // the real `state`. With no live stage there is no spin to spoil.
  const view = revealedView(
    state,
    linked && mirror?.shown != null ? mirror.shown : Number.POSITIVE_INFINITY,
  );
  const stats = eventStats(view);
  const remaining = selected ? remainingFor(state, selected) : 0;
  const selectedPrize = selected ? state.prizesById.get(selected) : undefined;
  const awardedHere = selected ? awardedFor(view, selected) : 0;

  const busy =
    linked && (mirror?.phase === "spinning" || mirror?.phase === "revealing");
  // Clamped here, once. The raw `count` can outlive a prize's stock (a draw
  // finished, or the operator switched prizes), and every consumer — the
  // stepper, the preset highlight and the command itself — must agree.
  const drawCount = Math.min(Math.max(1, count), Math.max(1, remaining));
  const canDraw = linked && !busy && !!selected && remaining > 0;
  const canStop = linked && (busy || (mirror?.pending ?? 0) > 0);
  const soundOn = state.settings.soundEnabled;

  const rosterLabel = !mirror?.roster
    ? null
    : mirror.roster === ROSTER_ALL
      ? "All winners"
      : (state.prizesById.get(mirror.roster)?.name ?? "Winners");
  const prizeShow = linked ? (mirror?.prizeShow ?? null) : null;
  const prizeShowName = prizeShow
    ? (state.prizesById.get(prizeShow.prizeId)?.name ?? null)
    : null;

  // The photo session, while the stage has a board up: the whole roster, and
  // the group the board is calling.
  const photoScope = linked ? (mirror?.roster ?? null) : null;
  const roster = photoScope ? photoRoster(view, photoScope, ROSTER_ALL) : [];
  const photoGroups = groupCount(roster.length);
  const photoGroup = mirror?.photo ? clampGroup(mirror.photo.group, roster.length) : 0;

  const revealedName = mirror?.revealed
    ? participantName(state, mirror.revealed)
    : null;

  const actions = {
    draw() {
      if (!canDraw || !selected) return;
      channel.post({ kind: "cmd:draw", prizeId: selected, count: drawCount });
    },
    stop() {
      if (canStop) channel.post({ kind: "cmd:stop" });
    },
    clear() {
      if (!busy) channel.post({ kind: "cmd:dismissWinner" });
    },
    next() {
      if (busy) return;
      // Clear the local pin so the remote follows the stage onto the next
      // prize instead of holding on to the one just finished.
      setPinned(null);
      channel.post({ kind: "cmd:nextPrize" });
    },
    undo() {
      if (!busy) channel.post({ kind: "cmd:undo" });
    },
    count(n: number) {
      setCount(Math.min(Math.max(1, n), Math.max(1, remaining)));
    },
  };

  // Keyboard handlers read the newest actions from a ref, so the listener is
  // bound once and can never act on a stale `canDraw` — the same stale-closure
  // class of bug that broke v2's Stop button.
  const live = useRef({ actions, drawCount });
  useEffect(() => {
    live.current = { actions, drawCount };
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const { actions: a, drawCount: n } = live.current;
      // Space on a focused button already clicks it; treating it as Draw as
      // well would fire two commands from one keypress.
      const onButton = e.target instanceof HTMLButtonElement;
      switch (e.key) {
        case " ":
          if (onButton) return;
          e.preventDefault();
          a.draw();
          break;
        case "s":
        case "S":
          a.stop();
          break;
        case "n":
        case "N":
          a.next();
          break;
        case "Escape":
          a.clear();
          break;
        case "ArrowUp":
          e.preventDefault();
          a.count(n + 1);
          break;
        case "ArrowDown":
          e.preventDefault();
          a.count(n - 1);
          break;
        default:
          return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!ready) {
    return (
      <main className="flex min-h-dvh items-center justify-center text-muted-foreground">
        <p className="ui-eyebrow">Loading…</p>
      </main>
    );
  }

  const badge = LINK_BADGE[link];

  return (
    <main className="flex min-h-dvh flex-col lg:grid lg:h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(380px,440px)] lg:grid-rows-[auto_auto_minmax(0,1fr)] lg:gap-x-5 lg:gap-y-3 lg:overflow-hidden lg:px-6 lg:pb-5">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur lg:col-span-2 lg:static lg:-mx-6 lg:px-6">
        <div className="min-w-0">
          <p className="ui-eyebrow text-muted-foreground">Control</p>
          <h1 className="truncate text-lg font-semibold text-foreground">
            {state.settings.eventName}
          </h1>
        </div>

        <Badge variant="outline" className={`shrink-0 ${badge.className}`}>
          <span
            aria-hidden
            className={`size-1.5 rounded-full ${badge.dot} ${busy ? "pulse-soft" : ""}`}
          />
          {badge.label}
        </Badge>

        <p className="ml-auto hidden text-xs tabular-nums text-muted-foreground md:block">
          {stats.awarded} awarded · {stats.remaining} slots left ·{" "}
          {stats.eligible} eligible
        </p>

        <div className="ml-auto flex shrink-0 items-center gap-1 md:ml-2">
          <Button
            variant="ghost"
            size="icon"
            aria-pressed={soundOn}
            aria-label={soundOn ? "Mute stage sound" : "Unmute stage sound"}
            title={soundOn ? "Mute stage sound" : "Unmute stage sound"}
            disabled={!linked}
            onClick={() =>
              channel.post({
                kind: "cmd:patchSettings",
                patch: { soundEnabled: !soundOn },
              })
            }
          >
            {soundOn ? <Volume2 /> : <VolumeX className="text-muted-foreground" />}
          </Button>
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm">
            <Link href="/">
              <Settings2 />
              <span className="hidden sm:inline">Setup</span>
            </Link>
          </Button>
        </div>
      </header>

      {/* Winners get the big pane: once the show is running, "who has won
          what" is what the presenter keeps looking back at. */}
      {/* The left column is its own track spanning both rows, so the status
          strip keeps its natural height instead of stretching to match the
          action panel beside it. */}
      <div className="flex flex-col gap-3 px-4 pt-4 lg:col-start-1 lg:row-span-2 lg:row-start-2 lg:min-h-0 lg:px-0 lg:pt-0 [&>section:last-child]:max-h-96 lg:[&>section:last-child]:max-h-none lg:[&>section:last-child]:flex-1">
        <NowOnStage
          mirror={mirror}
          link={link}
          now={now}
          revealedName={revealedName}
          rosterLabel={rosterLabel}
          boardLabel={
            prizeShow ? (prizeShow.revealed ? "Prize revealed" : "Prize up next") : undefined
          }
          boardTitle={prizeShow ? (prizeShowName ?? undefined) : undefined}
        />
        <ShowSettings
          channel={channel}
          settings={state.settings}
          disabled={!linked}
        />
        {/* During a photo session the big pane is the check-in for the group
            being called — the same people the winners list would show. */}
        {photoScope && mirror?.photo ? (
          <PhotoCheckIn
            channel={channel}
            title={rosterLabel ?? "Winners"}
            roster={groupSlice(roster, photoGroup)}
            photo={mirror.photo}
            group={photoGroup}
            groups={photoGroups}
          />
        ) : (
          <WinnersList state={view} prizeId={selected} wide />
        )}
      </div>

      {/* On a phone this is last and sticky, so Draw/Stop never scroll out
          from under the operator's thumb mid-show. */}
      <div className="sticky bottom-0 z-20 order-last mt-4 lg:static lg:order-none lg:col-start-2 lg:row-start-2 lg:mt-0">
        <ActionPanel
          count={drawCount}
          remaining={remaining}
          onCount={actions.count}
          prizeName={selectedPrize?.name}
          canDraw={canDraw}
          canStop={canStop}
          busy={busy}
          onDraw={actions.draw}
          onStop={actions.stop}
          onClear={actions.clear}
          onNext={actions.next}
          onUndo={actions.undo}
        />
      </div>

      <div className="flex flex-col gap-4 px-4 pt-4 lg:col-start-2 lg:row-start-3 lg:min-h-0 lg:gap-3 lg:px-0 lg:pt-0">
        <section
          aria-label="Prizes"
          className="flex flex-col rounded-2xl border border-border bg-card lg:min-h-44 lg:flex-1"
        >
          <div className="flex items-baseline justify-between gap-3 px-4 pb-1 pt-3">
            <h2 className="ui-eyebrow text-muted-foreground">Prizes</h2>
            <p className="text-xs tabular-nums text-muted-foreground">
              {stats.remaining} of {stats.totalSlots} left
            </p>
          </div>
          <ScrollArea className="max-h-96 lg:max-h-none lg:min-h-0 lg:flex-1">
            <PrizeList
              state={view}
              selected={selected}
              onStage={linked ? mirror?.prizeId : undefined}
              disabled={busy}
              onSelect={(prizeId) => {
                setPinned(prizeId);
                setCount(1);
                channel.post({ kind: "cmd:selectPrize", prizeId });
              }}
            />
          </ScrollArea>
        </section>
        <PrizeRevealControls
          channel={channel}
          busy={busy}
          linked={linked}
          selectedPrize={selectedPrize}
          shown={prizeShow}
          shownName={prizeShowName}
        />
        <PhotoSession
          channel={channel}
          busy={busy}
          rosterUp={!!mirror?.roster}
          selectedPrize={selectedPrize}
          awardedHere={awardedHere}
          awardedTotal={stats.awarded}
          photo={photoScope ? (mirror?.photo ?? null) : null}
          groups={photoGroups}
        />
      </div>
    </main>
  );
}
