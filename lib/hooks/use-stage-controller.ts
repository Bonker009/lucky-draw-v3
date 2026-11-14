"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { computeDraw } from "@/lib/domain/draw";
import { nextAvailablePrize, remainingFor } from "@/lib/domain/selectors";
import { getEngine } from "@/lib/engine/draw-engine";
import { useEngineSnapshot } from "@/lib/engine/use-draw-engine";
import {
  getChannel,
  sanitizeLiveSettings,
  type ChannelMessage,
} from "@/lib/channel";
import { useEventStore } from "@/lib/store/event-store";
import { useWriterLease } from "./use-writer-lease";
import { usePrefersReducedMotion } from "./use-frame-budget";

export interface StageController {
  ready: boolean;
  isOwner: boolean;
  selectedPrizeId: string | null;
  selectPrize: (prizeId: string) => void;
  draw: (count: number, prizeId?: string) => void;
  stop: () => void;
  undo: () => void;
  dismiss: () => void;
  nextPrize: () => void;
  /** Which photo-call board is showing: a prize id, ROSTER_ALL, or null. */
  rosterScope: string | null;
  showRoster: (scope: string) => void;
  hideRoster: () => void;
  error: string | null;
  clearError: () => void;
}

/**
 * The single place where a draw is started.
 *
 * Everything that can trigger a draw — the button, the spacebar, a command
 * from the control window — funnels through `draw()`, and `draw()` funnels
 * into one engine that rejects re-entry. v2 had three independent triggers
 * with no shared guard, which is how one click could start several draws.
 */
export function useStageController(options: {
  /** Only the stage owns writes; the control window mirrors. */
  isWriter: boolean;
  onWinnerRevealed?: (participantId: string) => void;
  onBatchComplete?: () => void;
}): StageController {
  const { state, ready, commit, undoLast, load, applyRemote, lastError, clearError } =
    useEventStore();
  const snapshot = useEngineSnapshot();
  const holdsLease = useWriterLease();
  const isOwner = options.isWriter && holdsLease;
  const reducedMotion = usePrefersReducedMotion();

  // null means "follow the running order"; an explicit id pins the choice.
  const [pinnedPrizeId, setPinnedPrizeId] = useState<string | null>(null);
  const [rosterScope, setRosterScope] = useState<string | null>(null);
  // How many winners existed when the current run started. Taken inside
  // draw(), before the engine commits anything, so it never races a commit.
  const [runBaseline, setRunBaseline] = useState(0);

  // Keep the newest values in a ref so the command handler never reads a
  // stale copy — the exact class of bug that broke v2's Stop button.
  // Derived, not stored: with no explicit pick, follow the first prize that
  // still has stock. Nothing to keep in sync, so nothing to fall out of sync.
  const selectedPrizeId =
    pinnedPrizeId ?? (ready ? (nextAvailablePrize(state)?.id ?? null) : null);

  /**
   * How many winners, in log order, the audience has actually seen.
   *
   * The engine commits before it spins, so during a run the log is ahead of
   * the drum. Other windows are told this number rather than left to infer it
   * from phases: the next commit lands while the phase still says
   * "revealing", and a remote that trusted the phase flashed the name before
   * the drum had even started. Once the run is over everything is shown,
   * including a winner left committed by Stop.
   */
  const running = snapshot.phase === "spinning" || snapshot.phase === "revealing";
  const shownWinners = running
    ? Math.min(state.winners.length, runBaseline + snapshot.batch.length)
    : state.winners.length;

  const latest = useRef({
    state,
    selectedPrizeId,
    isOwner,
    rosterScope,
    shownWinners,
  });

  useEffect(() => {
    latest.current = {
      state,
      selectedPrizeId,
      isOwner,
      rosterScope,
      shownWinners,
    };
  }, [state, selectedPrizeId, isOwner, rosterScope, shownWinners]);

  useEffect(() => {
    void load();
  }, [load]);

  const callbacks = useRef(options);

  useEffect(() => {
    callbacks.current = options;
  });

  const draw = useCallback(
    (count: number, prizeIdOverride?: string) => {
      const prizeId = prizeIdOverride ?? latest.current.selectedPrizeId;
      if (!prizeId) return;
      if (!latest.current.isOwner) {
        useEventStore.setState({
          lastError:
            "Another window is controlling this event. Draw from that window.",
        });
        return;
      }

      const engine = getEngine();
      if (engine.isRunning) return;

      // A draw takes the screen back from the photo-call board.
      setRosterScope(null);
      setRunBaseline(latest.current.state.winners.length);

      const settings = latest.current.state.settings;

      void engine.run(
        { prizeId, count },
        {
          spinDurationMs: settings.spinDurationMs,
          suspenseScaling: settings.suspenseScaling,
          revealHoldMs: settings.revealHoldMs,
          reducedMotion: reducedMotion || settings.reducedMotionOverride,
          onCommit: async () => {
            // Plan one winner at a time, against the state as it is right
            // now, and commit it in the same step.
            //
            // Planning the whole batch up front would be faster, but anything
            // that changed the roster mid-batch would invalidate the later
            // picks: a replay rebuilds eligibility from the folded log and
            // would then derive different winners, so the Verify button would
            // report the event as tampered with. Drawing one at a time makes
            // the log self-consistent by construction.
            const current = useEventStore.getState().state;
            let plan;
            try {
              plan = computeDraw(current, prizeId, 1);
            } catch {
              // Out of stock or out of eligible people: a normal end to the
              // batch, not an error to put on the projector.
              return null;
            }
            await commit(plan.events);
            return plan.winners[0];
          },
          onReveal: (participantId) => {
            callbacks.current.onWinnerRevealed?.(participantId);
          },
          onBatchComplete: () => {
            callbacks.current.onBatchComplete?.();
          },
        },
      );
    },
    [commit, reducedMotion],
  );

  const stop = useCallback(() => getEngine().stop(), []);
  const dismiss = useCallback(() => getEngine().dismiss(), []);

  const undo = useCallback(() => {
    if (getEngine().isRunning) return;
    // Undo removes a committed winner, so it belongs to the same single
    // owner as the draw itself.
    if (!latest.current.isOwner) return;
    void getEngine()
      .reset()
      .then(() => undoLast());
  }, [undoLast]);

  const selectPrize = useCallback((prizeId: string) => {
    if (getEngine().isRunning) return;
    setPinnedPrizeId(prizeId);
  }, []);

  const showRoster = useCallback((scope: string) => {
    // A photo call replaces the reel, so never put one up mid-spin.
    if (getEngine().isRunning) return;
    getEngine().dismiss();
    setRosterScope(scope);
  }, []);

  const hideRoster = useCallback(() => setRosterScope(null), []);

  const nextPrize = useCallback(() => {
    const { state: current, selectedPrizeId: prizeId } = latest.current;
    const next = nextAvailablePrize(current, prizeId ?? undefined);
    if (next) setPinnedPrizeId(next.id);
  }, []);

  // Commands in, phase broadcasts out.
  useEffect(() => {
    const channel = getChannel();

    const unsubscribe = channel.subscribe((message: ChannelMessage) => {
      switch (message.kind) {
        case "cmd:draw":
          if (!latest.current.isOwner) return;
          setPinnedPrizeId(message.prizeId);
          draw(message.count, message.prizeId);
          break;
        case "cmd:stop":
          if (latest.current.isOwner) stop();
          break;
        case "cmd:undo":
          if (latest.current.isOwner) undo();
          break;
        case "cmd:selectPrize":
          setPinnedPrizeId(message.prizeId);
          break;
        case "cmd:nextPrize":
          nextPrize();
          break;
        case "cmd:dismissWinner":
          if (latest.current.isOwner) dismiss();
          break;
        case "cmd:patchSettings": {
          // A settings change is still a write, so only the lease holder
          // commits it; the broadcast brings every other window along. It
          // takes effect from the next draw — the engine reads timing when a
          // run starts, so a batch already in flight keeps its pace.
          if (!latest.current.isOwner) return;
          const patch = sanitizeLiveSettings(message.patch);
          if (Object.keys(patch).length === 0) return;
          void commit([{ type: "SETTINGS_PATCHED", patch }]).catch(() => {});
          break;
        }
        case "cmd:showRoster":
          showRoster(message.scope);
          break;
        case "cmd:hideRoster":
          hideRoster();
          break;
        case "cmd:requestSnapshot": {
          // BroadcastChannel has no replay, so a control window opened after
          // the stage would otherwise never learn the current phase.
          if (!options.isWriter) return;
          const current = getEngine().getSnapshot();
          getChannel().post({
            kind: "evt:phase",
            phase: current.phase,
            prizeId: latest.current.selectedPrizeId ?? undefined,
            revealed: current.revealed,
            pending: current.pending,
            roster: latest.current.rosterScope,
            shown: latest.current.shownWinners,
          });
          break;
        }
        case "evt:committed":
          if (!latest.current.isOwner) applyRemote(message.events);
          break;
        case "evt:reloaded":
          if (!latest.current.isOwner) void load();
          break;
        default:
          break;
      }
    });

    return unsubscribe;
  }, [
    applyRemote,
    commit,
    dismiss,
    draw,
    hideRoster,
    load,
    nextPrize,
    options.isWriter,
    showRoster,
    stop,
    undo,
  ]);

  // Mirror what the projector is showing, so the operator can see it.
  useEffect(() => {
    if (!options.isWriter) return;
    getChannel().post({
      kind: "evt:phase",
      phase: snapshot.phase,
      prizeId: selectedPrizeId ?? undefined,
      revealed: snapshot.revealed,
      pending: snapshot.pending,
      roster: rosterScope,
      shown: shownWinners,
    });
  }, [
    rosterScope,
    shownWinners,
    options.isWriter,
    snapshot.phase,
    snapshot.revealed,
    snapshot.pending,
    selectedPrizeId,
  ]);

  return {
    ready,
    isOwner,
    selectedPrizeId,
    selectPrize,
    draw,
    stop,
    undo,
    dismiss,
    nextPrize,
    rosterScope,
    showRoster,
    hideRoster,
    error: lastError ?? snapshot.error,
    clearError,
  };
}

export function remainingForSelected(
  state: Parameters<typeof remainingFor>[0],
  prizeId: string | null,
) {
  return prizeId ? remainingFor(state, prizeId) : 0;
}
