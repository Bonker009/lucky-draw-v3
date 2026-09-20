"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { Backdrop } from "@/components/stage/backdrop";
import { Confetti, type ConfettiHandle } from "@/components/stage/confetti";
import { PhotoCall, ROSTER_ALL } from "@/components/stage/photo-call";
import { Reel } from "@/components/stage/reel";
import { WinnersRail } from "@/components/stage/winners-rail";
import { eligibleParticipants, remainingFor } from "@/lib/domain/selectors";
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
  const rehearsal = useEventStore((s) => s.rehearsal);
  const snapshot = useEngineSnapshot();
  const quality = useFrameBudget();
  const reducedMotion = usePrefersReducedMotion();
  const { isFullscreen, toggle } = useFullscreen();
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

  const onWinnerRevealed = useCallback(() => {
    sound.stopBed();
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
  } = controller;

  const prize = selectedPrizeId
    ? state.prizesById.get(selectedPrizeId)
    : undefined;
  const remaining = selectedPrizeId
    ? remainingFor(state, selectedPrizeId)
    : 0;
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

  // Names for the reel to blur past. Capped: the reel only samples from it,
  // and a 5000-entry array copied on every render is pure waste.
  const poolNames = useMemo(
    () =>
      eligibleParticipants(state)
        .slice(0, 300)
        .map((p) => p.name),
    [state],
  );

  const spinning = snapshot.phase === "spinning";
  /*
   * The drum is never unmounted: the name it stops on IS the reveal, so it has
   * to keep showing the winner through the hold as well as the spin. `target`
   * is set when the spin starts and cleared again when the engine finishes
   * celebrating, while `revealed` persists across the hold — so prefer
   * whichever one is populated.
   */
  const reelTargetId = snapshot.revealed ?? snapshot.target;
  const reelTargetName = reelTargetId
    ? (state.participantsById.get(reelTargetId)?.name ?? null)
    : null;

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
   * It is always exactly one, and only while the drum is actually running
   * towards a target. A stop leaves the winner committed and unrevealed on
   * purpose, and once the run is over the stage should show it.
   */
  const unrevealed = spinning && snapshot.target !== null ? 1 : 0;
  const busy = spinning || snapshot.phase === "revealing";
  const revealedParticipant = snapshot.revealed
    ? state.participantsById.get(snapshot.revealed)
    : undefined;

  useEffect(() => {
    if (spinning) sound.startBed();
  }, [spinning, sound]);

  // Read through a ref so the key handler is not rebound on every state
  // change, and never reads a stale roster scope.
  const latestRoster = useRef({ rosterScope, selectedPrizeId, showRoster, hideRoster });
  useEffect(() => {
    latestRoster.current = { rosterScope, selectedPrizeId, showRoster, hideRoster };
  }, [rosterScope, selectedPrizeId, showRoster, hideRoster]);

  // Keyboard: space draws one, S stops, P photo call, F fullscreen.
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
      } else if (e.key === "p" || e.key === "P") {
        const scope = latestRoster.current;
        if (scope.rosterScope) scope.hideRoster();
        else if (scope.selectedPrizeId) scope.showRoster(scope.selectedPrizeId);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [draw, stop, toggle]);

  if (!ready) {
    return (
      <main className="dark flex h-dvh items-center justify-center bg-base-900">
        <p className="stage-label text-ink-500">Loading event…</p>
      </main>
    );
  }

  if (state.prizes.length === 0 || state.participants.length === 0) {
    return (
      <main className="dark flex h-dvh flex-col items-center justify-center gap-6 bg-base-900 px-8 text-center">
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

  // Everything the audience can read is the revealed truth, not the committed
  // one. See `unrevealed` above.
  const shownRemaining = remaining + unrevealed;
  const awarded = (prize?.quantity ?? 0) - shownRemaining;
  const eligible =
    state.participants.length - state.winnerByParticipant.size + unrevealed;

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
    <main
      className="dark relative grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto_auto] overflow-hidden bg-base-900"
      data-motion={motionOff ? "off" : "on"}
    >
      <Backdrop imageUrl={backgroundUrl} quality={quality} />
      <Confetti ref={confettiRef} quality={quality} />

      <div
        ref={flashRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 z-40 bg-gold-bright opacity-0"
      />

      {/* ---- Top bar ---------------------------------------------------- */}
      <header className="relative z-30 flex items-center gap-4 px-8 pt-5">
        <p className="stage-label truncate text-[0.62rem] text-ink-500">
          {state.settings.eventName}
        </p>

        {/* Status as pills rather than full-width banners: on a projector a
            banner row costs vertical space the reel needs, permanently. */}
        <div className="flex items-center gap-2">
          {rehearsal ? (
            <span className="rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-medium text-gold-bright">
              Rehearsal — not saved
            </span>
          ) : null}
          {!isOwner ? (
            <span className="rounded-full border border-ink-500/30 bg-base-800/80 px-3 py-1 text-xs text-ink-300">
              Read-only — another window is in control
            </span>
          ) : null}
        </div>

        <p className="ml-auto shrink-0 text-sm tabular-nums text-ink-500">
          {eligible} eligible
        </p>
      </header>

      {/* ---- Photo call -------------------------------------------------- */}
      {/* Takes the whole stage area: during a photo session the room is
          looking for names, not at a reel. */}
      {rosterScope ? (
        <div className="relative z-20 flex min-h-0 flex-1">
          <PhotoCall
            state={state}
            scope={rosterScope}
            prizeImageUrl={rosterPrizeImageUrl}
            reducedMotion={motionOff}
          />
        </div>
      ) : null}

      {/* ---- Stage ------------------------------------------------------ */}
      {/* Hidden rather than unmounted: the reel keeps its DOM so returning
          from a photo call does not rebuild the strip mid-show. The `hidden`
          attribute would lose to Tailwind's `flex`, so the class does it. */}
      <div
        className={
          rosterScope ? "hidden" : "relative z-20 flex min-h-0"
        }
        aria-hidden={Boolean(rosterScope)}
      >
        <div className="relative grid min-h-0 flex-1 grid-rows-[1fr_auto_1fr] px-8">
          {/* A scrim local to the centre column. An uploaded background is
              usually a busy photo, and without this the names compete with it
              exactly where they most need to win. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background:
                "radial-gradient(ellipse 55% 60% at 50% 50%, rgb(6 8 13 / 0.82), transparent 75%)",
            }}
          />

          <header className="flex min-h-0 flex-col items-center justify-end gap-2 pb-[3vh]">
            {/* Keyed on the prize, so switching prizes remounts and replays
                the entrance rather than swapping the text silently. */}
            <h1
              key={prize?.id ?? "none"}
              className="prize-swap max-w-[20ch] text-balance text-center text-[clamp(1.75rem,4vh,3.25rem)] font-semibold text-gold"
            >
              {prize?.name ?? "Select a prize"}
            </h1>

            {/* Stock as pips while it is countable, as text once it is not.
                Twenty dots is a glanceable "nearly done"; two hundred is
                noise. */}
            {prize && prize.quantity <= 20 ? (
              <div
                className="flex flex-wrap items-center justify-center gap-1.5"
                role="img"
                aria-label={`${shownRemaining} of ${prize.quantity} remaining`}
              >
                {Array.from({ length: prize.quantity }, (_, i) => (
                  <span
                    key={i}
                    className={`size-2 rounded-full ${
                      i < awarded ? "bg-gold/25" : "bg-gold"
                    }`}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm tabular-nums text-ink-300">
                {shownRemaining} of {prize?.quantity ?? 0} remaining
              </p>
            )}
          </header>

          <div className="mx-auto flex w-full max-w-4xl items-center justify-center">
            <Reel
              pool={poolNames}
              target={reelTargetName}
              landed={snapshot.revealed !== null}
              durationMs={state.settings.spinDurationMs}
              quality={quality}
              reducedMotion={motionOff}
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

        <WinnersRail state={state} hideCount={unrevealed} />
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
      <footer
        className={`relative z-30 flex items-center justify-center gap-3 px-8 pb-5 pt-2 transition-opacity duration-500 ${
          busy ? "opacity-25" : "opacity-100"
        }`}
      >
        <button
          type="button"
          onClick={() => draw(1)}
          disabled={busy || remaining === 0}
          className="rounded-lg bg-gold px-6 py-2.5 font-medium text-base-900 disabled:opacity-40"
        >
          Draw
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={!busy}
          className="rounded-lg border border-ink-500/50 px-6 py-2.5 text-ink-100 disabled:opacity-40"
        >
          Stop
        </button>
        {/* Photo call: the whole point is to get every winner of this prize
            on screen at once so they can be called up together. */}
        {rosterScope ? (
          <button
            type="button"
            onClick={hideRoster}
            className="rounded-lg border border-gold px-6 py-2.5 text-gold-bright"
          >
            Close photo call
          </button>
        ) : (
          <button
            type="button"
            onClick={() => selectedPrizeId && showRoster(selectedPrizeId)}
            disabled={busy || !selectedPrizeId || awardedHere === 0}
            className="rounded-lg border border-ink-500/50 px-6 py-2.5 text-ink-100 disabled:opacity-40"
          >
            Photo call
          </button>
        )}

        <button
          type="button"
          onClick={() => void toggle()}
          className="rounded-lg border border-ink-500/50 px-6 py-2.5 text-ink-100"
        >
          {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        </button>

        <p className="ml-4 hidden text-xs text-ink-500 sm:block">
          Space to draw · S to stop · P for photo call · F for fullscreen
          {isFullscreen ? "" : " · open /control on your laptop"}
        </p>
      </footer>

    </main>
  );
}
