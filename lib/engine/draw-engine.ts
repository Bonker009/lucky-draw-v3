export type EnginePhase =
  | "idle"
  | "spinning"
  | "revealing"
  | "celebrating"
  | "stopped";

export interface EngineSnapshot {
  phase: EnginePhase;
  prizeId: string | null;
  /** The participant id currently on screen, once the reel has landed. */
  revealed: string | null;
  /** The winner the reel is spinning towards; the reel needs it up front. */
  target: string | null;
  /**
   * Every winner the current spin is heading for, in commit order. One id for
   * a normal draw; the whole batch when a batch is revealed in one spin
   * (`batchReveal`), which the name wall plays as "last N standing".
   */
  targets: string[];
  /** How long the current spin runs, suspense included; 0 when not spinning. */
  spinMs: number;
  /** How many winners of the current plan are still to come. */
  pending: number;
  batch: string[];
  error: string | null;
}

const IDLE: EngineSnapshot = {
  phase: "idle",
  prizeId: null,
  revealed: null,
  target: null,
  targets: [],
  spinMs: 0,
  pending: 0,
  batch: [],
  error: null,
};

export interface RunRequest {
  prizeId: string;
  /** Upper bound; the run stops early if the pool or the prize runs out. */
  count: number;
}

export interface RunOptions {
  spinDurationMs: number;
  /** Stretch the final picks of a batch for suspense. */
  suspenseScaling: boolean;
  /** How long a revealed name stays on screen before the next spin. */
  revealHoldMs?: number;
  /**
   * Pick and persist the next winner, atomically, returning who it is — or
   * null when there is nobody left to draw.
   *
   * Planning happens here, one winner at a time against current state, rather
   * than up front for the whole batch. A batch planned in advance can be
   * invalidated by anything that changes the roster mid-draw, and a replay
   * would then re-derive different winners and report the event as tampered.
   */
  onCommit: (index: number) => Promise<string | null>;
  onReveal?: (participantId: string, index: number) => void;
  onBatchComplete?: (winners: string[]) => void;
  reducedMotion?: boolean;
  /**
   * Reveal a multi-winner draw in one spin instead of one spin per winner.
   *
   * Every winner is committed first — still one `onCommit` at a time, against
   * current state, so the log stays self-consistent — and only then does the
   * single spin start, towards all of them. After it, each winner gets their
   * own reveal and hold in commit order (the spotlight), so nobody's moment is
   * merged into someone else's. A batch larger than `spotlightMax` is
   * revealed in one step instead: thirty consecutive spotlights would hold the
   * room for over a minute.
   */
  batchReveal?: { spotlightMax: number };
}

class AbortedError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortedError";
  }
}

/**
 * Drives a draw from outside React.
 *
 * v2 ran the multi-winner draw as a self-recursive setTimeout chain inside a
 * useCallback whose dependency array omitted the stop flag. Every stop check
 * read the value captured when the draw started, so the Stop button was inert
 * and the app looked frozen.
 *
 * Here cancellation is an AbortSignal read at await time, not a value captured
 * in a closure, and every timer is registered so abort() can clear it.
 */
export class DrawEngine {
  #snapshot: EngineSnapshot = IDLE;
  #listeners = new Set<() => void>();
  #abort: AbortController | null = null;
  #timers = new Set<ReturnType<typeof setTimeout>>();
  #inFlight = false;
  #generation = 0;
  #settled: (() => void) | null = null;

  getSnapshot = (): EngineSnapshot => this.#snapshot;

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  /** Exposed for tests: after a stop, nothing may still be scheduled. */
  get pendingTimerCount() {
    return this.#timers.size;
  }

  get isRunning() {
    return this.#inFlight;
  }

  #emit(patch: Partial<EngineSnapshot>) {
    this.#snapshot = { ...this.#snapshot, ...patch };
    for (const listener of this.#listeners) listener();
  }

  #sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new AbortedError());
        return;
      }
      const timer = setTimeout(() => {
        this.#timers.delete(timer);
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      this.#timers.add(timer);

      const onAbort = () => {
        clearTimeout(timer);
        this.#timers.delete(timer);
        reject(new AbortedError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  /**
   * Run a plan. Rejects re-entry, so a click, the spacebar and a remote
   * command arriving together still produce exactly one draw.
   */
  async run(request: RunRequest, options: RunOptions): Promise<void> {
    if (this.#inFlight) return;
    this.#inFlight = true;

    const generation = ++this.#generation;
    const controller = new AbortController();
    this.#abort = controller;
    const { signal } = controller;

    this.#emit({
      phase: "spinning",
      prizeId: request.prizeId,
      revealed: null,
      target: null,
      targets: [],
      spinMs: 0,
      pending: request.count,
      batch: [],
      error: null,
    });

    const revealed: string[] = [];

    try {
      if (options.batchReveal && request.count > 1) {
        await this.#runBatch(request, options, options.batchReveal, signal, revealed);
      } else for (let i = 0; i < request.count; i++) {
        if (signal.aborted) throw new AbortedError();

        // Commit first, reveal second. If this throws, the audience never
        // sees a name that was not recorded.
        const participantId = await options.onCommit(i);
        if (participantId === null) break;
        if (signal.aborted) throw new AbortedError();

        const remaining = request.count - i;
        const duration = options.reducedMotion
          ? 600
          : spinDuration(
              options.spinDurationMs,
              remaining,
              options.suspenseScaling,
            );

        this.#emit({
          phase: "spinning",
          target: participantId,
          targets: [participantId],
          spinMs: duration,
          revealed: null,
          pending: remaining,
        });

        await this.#sleep(duration, signal);

        revealed.push(participantId);
        this.#emit({
          phase: "revealing",
          revealed: participantId,
          batch: [...revealed],
          pending: request.count - i - 1,
        });
        options.onReveal?.(participantId, i);

        const hold =
          options.revealHoldMs ?? (options.reducedMotion ? 800 : 2200);
        await this.#sleep(hold, signal);
      }

      if (generation === this.#generation) {
        this.#emit({ phase: "celebrating", target: null, spinMs: 0 });
      }
      options.onBatchComplete?.(revealed);
    } catch (error) {
      // A reset that happened while this run was unwinding has already put
      // the snapshot where it wants it; do not stamp "stopped" over it.
      if (generation !== this.#generation) {
        // fall through to the finally block
      } else if (error instanceof AbortedError) {
        // A stop is a normal outcome, not a failure. Winners already
        // committed stay committed; the rest of the plan is simply dropped.
        this.#emit({ phase: "stopped", target: null, pending: 0 });
      } else {
        this.#emit({
          phase: "stopped",
          target: null,
          pending: 0,
          error:
            error instanceof Error ? error.message : "The draw could not run.",
        });
      }
    } finally {
      this.#clearTimers();
      if (generation === this.#generation) this.#abort = null;
      this.#inFlight = false;
      this.#settled?.();
      this.#settled = null;
    }
  }

  /** One spin towards every winner of the batch, then their reveals. */
  async #runBatch(
    request: RunRequest,
    options: RunOptions,
    batch: { spotlightMax: number },
    signal: AbortSignal,
    revealed: string[],
  ) {
    // Commit first, reveal second — for the whole batch. If any commit
    // throws, nothing has been shown yet.
    const targets: string[] = [];
    for (let i = 0; i < request.count; i++) {
      if (signal.aborted) throw new AbortedError();
      const participantId = await options.onCommit(i);
      if (participantId === null) break;
      targets.push(participantId);
    }
    if (signal.aborted) throw new AbortedError();
    if (targets.length === 0) return;

    // The one spin is the batch's finale, so it gets the finale's suspense.
    const duration = options.reducedMotion
      ? 600
      : spinDuration(options.spinDurationMs, 1, options.suspenseScaling);
    this.#emit({
      phase: "spinning",
      target: targets[0],
      targets,
      spinMs: duration,
      revealed: null,
      pending: targets.length,
    });
    await this.#sleep(duration, signal);

    const hold = options.revealHoldMs ?? (options.reducedMotion ? 800 : 2200);
    if (targets.length > batch.spotlightMax) {
      revealed.push(...targets);
      const last = targets[targets.length - 1];
      this.#emit({ phase: "revealing", revealed: last, batch: [...revealed], pending: 0 });
      // One reveal, one celebration: the whole group lands together.
      options.onReveal?.(last, targets.length - 1);
      await this.#sleep(hold, signal);
      return;
    }
    for (let k = 0; k < targets.length; k++) {
      if (signal.aborted) throw new AbortedError();
      revealed.push(targets[k]);
      this.#emit({
        phase: "revealing",
        revealed: targets[k],
        batch: [...revealed],
        pending: targets.length - k - 1,
      });
      options.onReveal?.(targets[k], k);
      await this.#sleep(hold, signal);
    }
  }

  /** Resolves once any in-flight run has fully unwound. */
  async idle(): Promise<void> {
    if (!this.#inFlight) return;
    await new Promise<void>((resolve) => {
      this.#settled = resolve;
    });
  }

  stop() {
    this.#abort?.abort();
    this.#clearTimers();
  }

  dismiss() {
    if (this.#inFlight) return;
    this.#emit({ ...IDLE, prizeId: this.#snapshot.prizeId });
  }

  /**
   * Abandon whatever is on screen and go back to idle.
   *
   * Bumping the generation first means the aborted run's own catch/finally,
   * which land a microtask later, cannot repaint "stopped" over this.
   */
  async reset(): Promise<void> {
    this.#generation++;
    this.#abort?.abort();
    this.#clearTimers();
    this.#abort = null;
    // Wait for the run to unwind, or #inFlight is still true when the
    // operator presses Draw again and the re-entry guard silently eats it.
    await this.idle();
    this.#snapshot = IDLE;
    for (const listener of this.#listeners) listener();
  }

  #clearTimers() {
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
  }
}

/**
 * The last few picks of a batch spin longer. Same trick v2 used, but bounded
 * and computed from arguments rather than a stale captured setting.
 */
export function spinDuration(
  base: number,
  remaining: number,
  suspenseScaling: boolean,
): number {
  if (!suspenseScaling || remaining > 4 || remaining < 1) return base;
  // remaining === 1 is the final winner of the batch, so it spins longest.
  const factor = [2.2, 1.8, 1.5, 1.25][remaining - 1];
  return Math.min(base * factor, 15000);
}

let shared: DrawEngine | null = null;

export function getEngine(): DrawEngine {
  if (!shared) shared = new DrawEngine();
  return shared;
}
