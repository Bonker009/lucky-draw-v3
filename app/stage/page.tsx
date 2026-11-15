"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import Link from "next/link";
import { MotionConfig } from "motion/react";
import { AnimatedShinyText } from "@/components/ui/animated-shiny-text";
import { Backdrop } from "@/components/stage/backdrop";
import { Confetti, type ConfettiHandle } from "@/components/stage/confetti";
import { GemField } from "@/components/stage/gem-field";
import { WALL_KEEP_OUT } from "@/lib/stage/gem-layout";
import { PhotoCall, ROSTER_ALL } from "@/components/stage/photo-call";
import { PrizeReveal } from "@/components/stage/prize-reveals/prize-reveal";
import { DrawReveal } from "@/components/stage/reveals/draw-reveal";
import { HOLDS_FINALE } from "@/components/stage/reveals/meta";
import type { RevealEntry } from "@/components/stage/reveals/types";
import { WinnersRail } from "@/components/stage/winners-rail";
import {
  eligibleParticipants,
  orderedPrizes,
  remainingFor,
} from "@/lib/domain/selectors";
import type { DrawStyle } from "@/lib/domain/types";
import { spinDuration } from "@/lib/engine/draw-engine";
import { useEngineSnapshot } from "@/lib/engine/use-draw-engine";
import { useAssetUrl } from "@/lib/hooks/use-asset-url";
import {
  useFrameBudget,
  usePrefersReducedMotion,
} from "@/lib/hooks/use-frame-budget";
import { useFullscreen } from "@/lib/hooks/use-fullscreen";
import { useSound } from "@/lib/hooks/use-sound";
import { useStageController } from "@/lib/hooks/use-stage-controller";
import { useEventStore } from "@/lib/store/event-store";

export default function StagePage() {
  const state = useEventStore((s) => s.state);
  const commit = useEventStore((s) => s.commit);
  const rehearsal = useEventStore((s) => s.rehearsal);
  const snapshot = useEngineSnapshot();
  const quality = useFrameBudget();
  const reducedMotion = usePrefersReducedMotion();
  const { isFullscreen, toggle } = useFullscreen();

  // The control bar shows on mouse movement and fades after a short idle, so
  // the audience never sees buttons but the operator can always reach them.
  const [controlsVisible, setControlsVisible] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onMove = () => {
      setControlsVisible(true);
      clearTimeout(timer);
      timer = setTimeout(() => setControlsVisible(false), 2500);
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      clearTimeout(timer);
    };
  }, []);
  const confettiRef = useRef<ConfettiHandle>(null);

  const sound = useSound({
    enabled: state.settings.soundEnabled,
    winAssetId: state.settings.winAudioAssetId,
  });

  // One flag for "the audience asked for less movement", from either the OS
  // setting or the event's own override.
  const motionOff = reducedMotion || state.settings.reducedMotionOverride;
  const motionOffRef = useRef(motionOff);
  useEffect(() => {
    motionOffRef.current = motionOff;
  }, [motionOff]);

  const flashRef = useRef<HTMLDivElement>(null);

  // The style on screen, for the reveal callback below. Held steady through a
  // run (see `drawStyle`), so reading it from a ref is never stale mid-draw.
  const drawStyleRef = useRef<DrawStyle>("wall");
  // The last winner whose reveal has fully played out — for styles that keep
  // revealing after the engine does (the split-flap board types the name).
  const [finaleFor, setFinaleFor] = useState<string | null>(null);

  const celebrate = useCallback(() => {
    sound.playWin();

    // One frame of light across the whole projector, on the same beat as the
    // confetti. Re-adding the class in the frame it was removed is coalesced,
    // so the reflow read is what makes it replay on the second winner.
    const flash = flashRef.current;
    if (flash && !motionOffRef.current) {
      flash.classList.remove("win-flash");
      void flash.offsetWidth;
      flash.classList.add("win-flash");
    }
    // Confetti is canvas, so no CSS media query can reach it. Gate it here or
    // 180 particles fire at someone who explicitly asked for no motion.
    if (!motionOffRef.current) confettiRef.current?.burst();
  }, [sound]);

  /*
   * Most styles are finished the moment the engine reveals. The split-flap
   * board is not: it types the name out over several seconds, and with the
   * fanfare and confetti on the reveal the room cheered the first letter and
   * the rest of the name arrived as an afterthought. Such a style calls
   * `onFinale` once the name is complete, and the celebration waits for it.
   */
  const onWinnerRevealed = useCallback(() => {
    if (!HOLDS_FINALE.has(drawStyleRef.current)) celebrate();
  }, [celebrate]);
  const onRevealFinale = useCallback(
    (participantId: string) => {
      setFinaleFor(participantId);
      celebrate();
    },
    [celebrate],
  );

  const controller = useStageController({
    isWriter: true,
    onWinnerRevealed,
  });

  const {
    ready,
    isOwner,
    selectedPrizeId,
    draw,
    stop,
    error,
    clearError,
    rosterScope,
    showRoster,
    hideRoster,
    photo,
    photoAction,
    prizeShow,
    prizeAction,
  } = controller;

  const prize = selectedPrizeId
    ? state.prizesById.get(selectedPrizeId)
    : undefined;
  const remaining = selectedPrizeId ? remainingFor(state, selectedPrizeId) : 0;
  const awardedHere = selectedPrizeId
    ? (state.awardedByPrize.get(selectedPrizeId) ?? 0)
    : 0;

  const backgroundUrl = useAssetUrl(state.settings.backgroundAssetId);
  // The photo-call board can show a prize other than the selected one, so it
  // resolves its own image rather than borrowing the stage's.
  const rosterPrize =
    rosterScope && rosterScope !== ROSTER_ALL
      ? state.prizesById.get(rosterScope)
      : undefined;
  const rosterPrizeImageUrl = useAssetUrl(rosterPrize?.imageAssetId);

  // The prize being announced, with where it sits in the night.
  const shownPrize = prizeShow ? state.prizesById.get(prizeShow.prizeId) : undefined;
  const shownPrizeImageUrl = useAssetUrl(shownPrize?.imageAssetId);
  const lineup = useMemo(
    () =>
      orderedPrizes(state).map((p) => ({
        id: p.id,
        name: p.name,
        imageAssetId: p.imageAssetId,
        state:
          p.id === prizeShow?.prizeId
            ? ("current" as const)
            : remainingFor(state, p.id) === 0
              ? ("done" as const)
              : ("upcoming" as const),
      })),
    [state, prizeShow?.prizeId],
  );
  const prizePosition = Math.max(1, lineup.findIndex((p) => p.id === prizeShow?.prizeId) + 1);

  // A prize unveiled gets the heavy clunk; the fanfare stays for winners.
  const prizeRevealed = Boolean(prizeShow?.revealed);
  useEffect(() => {
    if (prizeRevealed) sound.playPrize();
  }, [prizeRevealed, sound]);

  const spinning = snapshot.phase === "spinning";
  /*
   * The drum is never unmounted: the name it stops on IS the reveal, so it has
   * to keep showing the winner through the hold as well as the spin. `target`
   * is set when the spin starts and cleared again when the engine finishes
   * celebrating, while `revealed` persists across the hold — so prefer
   * whichever one is populated.
   */
  const reelTargetId = snapshot.revealed ?? snapshot.target;
  // The batch the current spin is heading for (one id unless the wall is
  // revealing several winners in one run), and which of it has been shown.
  const runTargets = snapshot.targets;
  const runRevealed = useMemo(
    () => snapshot.batch.filter((id) => runTargets.includes(id)),
    [snapshot.batch, runTargets],
  );

  /*
   * Everyone on the wall, in roster order. Uncapped on purpose — a cap meant
   * that at a bigger event some people could never appear at all.
   *
   * The target is added back in: it is committed before the wall starts, so
   * `eligibleParticipants` has already dropped it, and a wall without the
   * winner on it would have nothing to land on. Ids, not names, so two people
   * called the same thing stay two tiles. Memoised on `state`, so it is
   * rebuilt per commit, not per frame.
   */
  const wallPool = useMemo<RevealEntry[]>(() => {
    const ids = new Set(eligibleParticipants(state).map((p) => p.id));
    if (reelTargetId) ids.add(reelTargetId);
    for (const id of runTargets) ids.add(id);
    return state.participants
      .filter((p) => ids.has(p.id))
      .map((p) => ({ id: p.id, name: p.name }));
  }, [state, reelTargetId, runTargets]);

  const busy = spinning || snapshot.phase === "revealing";

  /*
   * The draw style, held steady while a draw runs. Switching from setup mid-
   * draw would unmount the reveal that is halfway to the winner, so a change
   * waits for the stage to be idle. Adjusted during render, not in an effect,
   * so the swap costs no extra pass and can never land mid-run.
   */
  const requestedStyle = state.settings.drawStyle ?? "wall";
  const [drawStyle, setDrawStyle] = useState(requestedStyle);
  if (!busy && drawStyle !== requestedStyle) setDrawStyle(requestedStyle);
  useEffect(() => {
    drawStyleRef.current = drawStyle;
  }, [drawStyle]);

  /*
   * How many winners are committed but not yet on screen.
   *
   * The engine commits a winner and only then starts the drum towards them —
   * that ordering is what makes "announced but never saved" impossible. The
   * side effect is that everything derived from `state` knows the answer for
   * the entire spin: the winners rail printed the name, the remaining count
   * ticked down, and a pip went dark, all while the audience watched the reel
   * still turning.
   *
   * Normally 0 or 1: 1 while the drum is actually running towards a target,
   * and — for a style that types the name out after the reveal — until the
   * last letter is down, or the rail printed the whole name beside the board
   * while it was still on its first letter. When the wall reveals a batch in
   * one run, it is every winner of the batch not yet called forward: all N
   * during the spin, then one fewer per spotlight. A stop leaves winners
   * committed and unrevealed on purpose, and once the run is over the stage
   * should show them.
   */
  const typing =
    HOLDS_FINALE.has(drawStyle) &&
    snapshot.phase === "revealing" &&
    snapshot.revealed !== null &&
    finaleFor !== snapshot.revealed;
  const unrevealed = busy
    ? Math.max(0, runTargets.length - runRevealed.length) + (typing ? 1 : 0)
    : 0;

  /*
   * How long the engine will actually spin for this winner. The engine
   * stretches the last few picks of a batch for suspense; a reveal sized to the
   * base duration finished early and showed the name before the engine had
   * revealed it. Read by each style once, when its run starts.
   */
  const revealMs =
    snapshot.spinMs ||
    spinDuration(
      state.settings.spinDurationMs,
      snapshot.pending,
      state.settings.suspenseScaling,
    );
  const revealedParticipant = snapshot.revealed
    ? state.participantsById.get(snapshot.revealed)
    : undefined;

  // The photo session gets its own cue, whether it was opened here or from
  // /control. Closing the board cuts it off rather than letting 8 s run on.
  useEffect(() => {
    if (!rosterScope) return;
    sound.playPhotoCall();
    return () => sound.stopPhotoCall();
  }, [rosterScope, sound]);

  // Read through a ref so the key handler is not rebound on every state
  // change, and never reads a stale roster scope.
  const latestRoster = useRef({
    rosterScope,
    selectedPrizeId,
    showRoster,
    hideRoster,
    photo,
    photoAction,
    prizeShow,
    prizeAction,
  });
  useEffect(() => {
    latestRoster.current = {
      rosterScope,
      selectedPrizeId,
      showRoster,
      hideRoster,
      photo,
      photoAction,
      prizeShow,
      prizeAction,
    };
  }, [rosterScope, selectedPrizeId, showRoster, hideRoster, photo, photoAction, prizeShow, prizeAction]);

  /*
   * The winners list can be hidden for the room (W, or the remote's switch).
   * It is a setting, not local state, so it survives a reload and the remote
   * shows the same thing. Only the lease holder writes it; a read-only window
   * leaves it alone like every other write.
   */
  const showRail = state.settings.showWinnersRail ?? true;
  const railRef = useRef({ showRail, isOwner, commit });
  useEffect(() => {
    railRef.current = { showRail, isOwner, commit };
  }, [showRail, isOwner, commit]);
  const toggleRail = useCallback(() => {
    const { showRail: on, isOwner: owner, commit: write } = railRef.current;
    if (!owner) return;
    void write([
      { type: "SETTINGS_PATCHED", patch: { showWinnersRail: !on } },
    ]).catch(() => {});
  }, []);

  // Keyboard: space draws one, S stops, P photo call, F fullscreen, W winners list.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Shortcuts are accelerators for the buttons, not a replacement for
      // them. If anything focusable has focus, let it have the key: hijacking
      // Space globally means a keyboard operator who tabs to Dismiss and
      // presses Space starts a draw instead, live on the projector.
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          'input, textarea, select, button, a[href], [contenteditable=""], [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
        )
      ) {
        return;
      }

      // Modified keys belong to the browser and to assistive tech.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.code === "Space") {
        // preventDefault stops the page scrolling; the guard above is what
        // keeps a focused button from also firing.
        e.preventDefault();
        draw(1);
      } else if (e.key === "s" || e.key === "S") {
        stop();
      } else if (e.key === "f" || e.key === "F") {
        void toggle();
      } else if (e.key === "w" || e.key === "W") {
        toggleRail();
      } else if (e.key === "p" || e.key === "P") {
        const scope = latestRoster.current;
        if (scope.rosterScope) scope.hideRoster();
        else if (scope.selectedPrizeId) scope.showRoster(scope.selectedPrizeId);
      } else if (e.key === "r" || e.key === "R") {
        // R walks the prize announcement: up next, revealed, back to the draw.
        const { prizeShow: shown, prizeAction: act } = latestRoster.current;
        act(!shown ? { type: "show" } : !shown.revealed ? { type: "reveal" } : { type: "hide" });
      } else if (latestRoster.current.rosterScope) {
        // Photo session keys, only while a board is up: B flips call-up and
        // backdrop, the arrows move between groups of a big prize.
        const { photo: current, photoAction: act } = latestRoster.current;
        if (e.key === "b" || e.key === "B") {
          act({ type: "mode", mode: current.mode === "call" ? "backdrop" : "call" });
        } else if (e.key === "ArrowRight") {
          act({ type: "group", group: current.group + 1 });
        } else if (e.key === "ArrowLeft") {
          act({ type: "group", group: current.group - 1 });
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [draw, stop, toggle, toggleRail]);

  if (!ready) {
    return (
      <main className="stage-bg dark flex h-dvh items-center justify-center">
        <p className="stage-label">
          <AnimatedShinyText className="text-ink-500/80 dark:text-ink-500/80" shimmerWidth={160}>
            Loading event…
          </AnimatedShinyText>
        </p>
      </main>
    );
  }

  if (state.prizes.length === 0 || state.participants.length === 0) {
    return (
      <main className="stage-bg dark flex h-dvh flex-col items-center justify-center gap-6 px-8 text-center">
        <h1 className="text-3xl font-semibold text-ink-100">
          Nothing to draw yet
        </h1>
        <p className="max-w-md text-ink-300">
          Add participants and at least one prize before opening the stage.
        </p>
        <Link
          href="/"
          className="rounded-lg bg-gold px-6 py-3 font-medium text-base-900"
        >
          Go to setup
        </Link>
      </main>
    );
  }

  return (
    /*
     * A fixed one-viewport grid: h-dvh, overflow-hidden, and a middle row that
     * is min-h-0 so it absorbs whatever space is left rather than growing.
     *
     * This is the whole point of the layout. The previous version was a
     * min-h-dvh column, so once the winners rail had a dozen names the
     * projector had a scrollbar and the Draw button sat below the fold — on
     * the one screen in the building that nobody can scroll.
     */
    // Every motion-based (Magic UI) effect on the stage obeys the event's own
    // "Force reduced motion" switch, not only the OS setting.
    <MotionConfig reducedMotion={motionOff ? "always" : "user"}>
    <main
      className="stage-bg dark relative grid h-dvh grid-rows-[minmax(0,1fr)_auto] overflow-hidden"
      data-motion={motionOff ? "off" : "on"}
    >
      <Backdrop imageUrl={backgroundUrl} quality={quality} />
      {/* Its own arrangement per view, so the photo session does not look
          like the draw with the names swapped. Fainter behind the draw, where
          names fill the screen. */}
      <GemField
        seed={rosterScope ? "photo" : prizeShow ? "prize" : `stage-${drawStyle}`}
        strength={rosterScope ? 0.6 : 0.4}
        keepOut={!rosterScope && drawStyle === "wall" ? WALL_KEEP_OUT : undefined}
        quality={quality}
      />
      <Confetti ref={confettiRef} quality={quality} />

      <div
        ref={flashRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 z-40 bg-gold-bright opacity-0"
      />

      {/* ---- Status ----------------------------------------------------- */}
      {/* The stage is only the machine and the winners. These two pills are
          the exception, and only appear when true: drawing in a read-only
          window does nothing, and a rehearsal draw is never saved — both are
          things the operator must not miss. */}
      {rehearsal || !isOwner ? (
        <div className="pointer-events-none absolute left-6 top-4 z-30 flex items-center gap-2">
          {rehearsal ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-ink-100/10 bg-ink-100/5 px-3.5 py-1.5 text-xs font-medium text-ink-300">
              <span aria-hidden className="size-1.5 rounded-full bg-gold-bright" />
              Rehearsal — not saved
            </span>
          ) : null}
          {!isOwner ? (
            <span className="inline-flex items-center gap-2 rounded-full border border-ink-100/10 bg-ink-100/5 px-3.5 py-1.5 text-xs font-medium text-ink-300">
              <span aria-hidden className="size-1.5 rounded-full bg-ink-500" />
              Read-only — another window is in control
            </span>
          ) : null}
        </div>
      ) : null}

      {/* ---- Photo call -------------------------------------------------- */}
      {/* Takes the whole stage area: during a photo session the room is
          looking for names, not at the wall. */}
      {rosterScope ? (
        <div className="relative z-20 flex min-h-0 flex-1">
          <PhotoCall
            state={state}
            scope={rosterScope}
            prizeImageUrl={rosterPrizeImageUrl}
            photo={photo}
            reducedMotion={motionOff}
          />
        </div>
      ) : null}

      {/* ---- Prize announcement ------------------------------------------ */}
      {/* Before a prize is drawn for: covered, then revealed, by the
          presenter. Keyed on the prize so a new one always starts covered. */}
      {shownPrize && prizeShow && !rosterScope ? (
        <div className="relative z-20 flex min-h-0 flex-1 px-[2vw] py-[3vh]">
          <PrizeReveal
            key={prizeShow.prizeId}
            style={state.settings.prizeRevealStyle ?? "cover"}
            name={shownPrize.name}
            imageUrl={shownPrizeImageUrl}
            revealed={prizeShow.revealed}
            position={prizePosition}
            total={lineup.length}
            toWin={remainingFor(state, shownPrize.id)}
            lineup={lineup}
            reducedMotion={motionOff}
            quality={quality}
          />
        </div>
      ) : null}

      {/* ---- Stage ------------------------------------------------------ */}
      {/* Hidden rather than unmounted: the wall keeps its canvas and its run,
          so returning from a photo call does not restart a sweep mid-show.
          The `hidden` attribute would lose to Tailwind's `flex`, so the class
          does it. */}
      <div
        className={rosterScope || shownPrize ? "hidden" : "relative z-20 flex min-h-0"}
        aria-hidden={Boolean(rosterScope || shownPrize)}
      >
        <div className="relative flex min-h-0 flex-1 flex-col px-[3.3vw] pb-[5vh] pt-[7vh]">
          {/* A scrim local to the centre column. An uploaded background is
              usually a busy photo, and without this the names compete with it
              exactly where they most need to win. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background:
                "radial-gradient(ellipse 60% 65% at 50% 50%, rgb(16 20 48 / 0.8), transparent 78%)",
            }}
          />

          {/* The prize is named for screen readers only: the projector shows
              just the machine, and the presenter picks the prize on /control.
              The e2e suite also waits on this heading as its ready signal. */}
          <h1 className="sr-only">{prize?.name ?? "Select a prize"}</h1>

          {/* The wall: everyone in the draw, knocked out in halves until the
              committed winner is the one left. It reveals, it never picks. */}
          <div className="flex min-h-0 w-full flex-1">
            <DrawReveal
              style={drawStyle}
              pool={wallPool}
              targetId={reelTargetId}
              targetIds={runTargets}
              revealedIds={runRevealed}
              landed={snapshot.revealed !== null}
              durationMs={revealMs}
              quality={quality}
              reducedMotion={motionOff}
              onTick={sound.tick}
              onFinale={onRevealFinale}
            />
          </div>

          {/*
            One live region, always mounted, written into.
            A region inserted already-populated is announced unreliably, so
            mounting WinnerReveal alongside its text would leave a screen
            reader silent at the only moment that matters.
          */}
          <div className="min-h-0">
            <p
              className="sr-only"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {revealedParticipant
                ? `${prize?.name ?? "Winner"}: ${revealedParticipant.name}`
                : ""}
            </p>
          </div>
        </div>

        {showRail ? <WinnersRail state={state} hideCount={unrevealed} /> : null}
      </div>

      {/* ---- Controls --------------------------------------------------- */}
      {/* The shortcuts are accelerators; these are the actual controls, so the
          stage is operable without a second window. They fade back while a
          draw runs so the audience looks at the name, not the buttons. */}
      {error ? (
        <div
          role="alert"
          className="relative z-40 flex items-center justify-between gap-4 bg-red-900/95 px-8 py-3 text-ink-100"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={clearError}
            className="rounded bg-ink-100/10 px-4 py-1 text-sm"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {/* Overlaid and hidden until the mouse moves, so the projector shows
          only the machine and the winners. Keyboard shortcuts work either
          way, and focus-within keeps it visible while tabbing through. */}
      <footer
        className={`absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-ink-100/10 bg-base-800/80 p-1.5 shadow-[0_24px_60px_rgb(0_0_0/0.5)] backdrop-blur-xl transition-opacity duration-500 focus-within:pointer-events-auto focus-within:opacity-100 ${
          controlsVisible && !busy
            ? "opacity-100"
            : "pointer-events-none opacity-0"
        }`}
      >
        {/* Draw and Stop are hidden during a photo call: the board is for
            finding names, and drawing closes it anyway (Space still works). */}
        {rosterScope ? null : (
          <>
            <StageButton
              primary
              shortcut="Space"
              onClick={() => draw(1)}
              disabled={busy || remaining === 0}
            >
              Draw
            </StageButton>
            <StageButton shortcut="S" onClick={stop} disabled={!busy}>
              Stop
            </StageButton>
            <span aria-hidden className="mx-1 h-6 w-px bg-ink-100/10" />
          </>
        )}
        {/* Photo call: the whole point is to get every winner of this prize
            on screen at once so they can be called up together. */}
        {rosterScope ? (
          <StageButton primary shortcut="P" onClick={hideRoster}>
            Close photo call
          </StageButton>
        ) : (
          <StageButton
            shortcut="P"
            onClick={() => selectedPrizeId && showRoster(selectedPrizeId)}
            disabled={busy || !selectedPrizeId || awardedHere === 0}
          >
            Photo call
          </StageButton>
        )}
        <StageButton
          shortcut="W"
          onClick={toggleRail}
          aria-pressed={showRail}
          disabled={!isOwner}
        >
          {showRail ? "Hide winners" : "Show winners"}
        </StageButton>
        <StageButton shortcut="F" onClick={() => void toggle()}>
          {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        </StageButton>
      </footer>
    </main>
    </MotionConfig>
  );
}

/**
 * One control-bar button with its keyboard shortcut shown on it. The shortcuts
 * used to be a separate line of prose beside the buttons, which read as clutter
 * on the projector; a key chip says the same thing where the eye already is.
 */
function StageButton({
  primary = false,
  shortcut,
  children,
  ...props
}: ComponentProps<"button"> & { primary?: boolean; shortcut: string }) {
  return (
    <button
      type="button"
      aria-keyshortcuts={
        shortcut === "Space" ? "Space" : shortcut.toLowerCase()
      }
      {...props}
      // Ink, not gold: gold on the stage means "the winner", and a gold
      // button sat right under the winner's gold name.
      className={`inline-flex h-11 items-center gap-2.5 rounded-full px-5 text-sm font-medium transition-[background-color,scale] duration-150 ease-out enabled:active:scale-[0.96] disabled:opacity-40 motion-reduce:enabled:active:scale-100 ${
        primary
          ? "bg-ink-100 text-base-900 hover:bg-white"
          : "text-ink-300 hover:bg-ink-100/10 hover:text-ink-100"
      }`}
    >
      {children}
      <kbd
        aria-hidden
        className={`rounded px-1.5 py-0.5 font-sans text-[0.65rem] leading-none ${
          primary
            ? "bg-base-900/10 text-base-900/60"
            : "bg-ink-100/10 text-ink-500"
        }`}
      >
        {shortcut}
      </kbd>
    </button>
  );
}
