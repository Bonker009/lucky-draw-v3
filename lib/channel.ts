import type { Settings, StoredEvent } from "@/lib/domain/types";
import type { PhotoState } from "@/lib/stage/photo-session";
import type { PrizeShow } from "@/lib/stage/prize-show";

export const CHANNEL_NAME = "lucky-draw-v3";

/**
 * The settings the remote may change mid-show: how the draw *looks*, never
 * what it picks. The seed and the prize order stay out on purpose — the seed
 * is in the published commitment, and changing either from a phone mid-event
 * is not something anyone should be able to do by accident.
 */
export type LiveSettings = Pick<
  Settings,
  | "spinDurationMs"
  | "revealHoldMs"
  | "suspenseScaling"
  | "soundEnabled"
  | "reducedMotionOverride"
  | "showWinnersRail"
>;

/**
 * Floors only. The operator sets these against a run-of-show and may want a
 * 30-second spin for the grand prize, so there is no ceiling; the floor exists
 * because a zero-length spin has nothing to animate.
 */
export const TIMING_LIMITS = {
  spinDurationMs: { min: 100 },
  revealHoldMs: { min: 0 },
} as const;

/**
 * Keep only the live keys, with sane values. The stage runs this on every
 * `cmd:patchSettings`, because a BroadcastChannel message is just data — any
 * tab on the origin can post one.
 */
export function sanitizeLiveSettings(patch: unknown): Partial<LiveSettings> {
  if (!patch || typeof patch !== "object") return {};
  const p = patch as Record<string, unknown>;
  const out: Partial<LiveSettings> = {};
  for (const key of ["spinDurationMs", "revealHoldMs"] as const) {
    const v = p[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      out[key] = Math.round(Math.max(TIMING_LIMITS[key].min, v));
    }
  }
  for (const key of [
    "suspenseScaling",
    "soundEnabled",
    "reducedMotionOverride",
    "showWinnersRail",
  ] as const) {
    if (typeof p[key] === "boolean") out[key] = p[key];
  }
  return out;
}

/** Commands travel control -> stage. The stage is the only writer. */
export type Command =
  | { kind: "cmd:draw"; prizeId: string; count: number }
  | { kind: "cmd:stop" }
  | { kind: "cmd:undo" }
  | { kind: "cmd:selectPrize"; prizeId: string }
  | { kind: "cmd:nextPrize" }
  /** Timing, sound and motion — see `LiveSettings`. Committed by the stage. */
  | { kind: "cmd:patchSettings"; patch: Partial<LiveSettings> }
  | { kind: "cmd:dismissWinner" }
  /**
   * Put the photo-call board on the projector: every winner of one prize, or
   * of the whole event, at once. `scope` is a prize id, or "all".
   */
  | { kind: "cmd:showRoster"; scope: string }
  | { kind: "cmd:hideRoster" }
  /**
   * Photo session presentation: mode, group, check-in, no-show. A
   * `PhotoAction`, checked by the stage against the roster that is up (see
   * `applyPhotoAction`) — typed loosely because any tab can post anything.
   */
  | { kind: "cmd:photo"; action: unknown }
  /** Announce / reveal / hide a prize. A `PrizeAction`, checked by the stage. */
  | { kind: "cmd:prize"; action: unknown }
  | { kind: "cmd:requestSnapshot" };

/** Broadcasts travel stage -> everyone, so other windows can mirror it. */
export type Broadcast =
  | { kind: "evt:committed"; events: StoredEvent[] }
  | { kind: "evt:reloaded" }
  | {
      kind: "evt:phase";
      phase: string;
      prizeId?: string;
      revealed?: string | null;
      pending: number;
      /** Which photo-call board is up, if any. */
      roster?: string | null;
      /** The photo session's mode, group and check-ins, while a board is up. */
      photo?: PhotoState | null;
      /** The prize announced on the projector, if any, and whether revealed. */
      prizeShow?: PrizeShow | null;
      /**
       * How many winners, in log order, the projector has revealed. During a
       * spin the log already holds the winner the drum is heading for; a
       * remote must not show more than this or it spoils the reveal.
       */
      shown?: number;
    };

export type ChannelMessage = Command | Broadcast;

type Handler = (message: ChannelMessage) => void;

/**
 * Thin typed wrapper over BroadcastChannel.
 *
 * Deliberately has no "force reload" message. v2 had one, and a reload
 * arriving mid-draw destroyed the in-flight chain on the projector.
 */
export class Channel {
  #bc: BroadcastChannel | null = null;
  #handlers = new Set<Handler>();

  constructor() {
    if (typeof BroadcastChannel === "undefined") return;
    this.#bc = new BroadcastChannel(CHANNEL_NAME);
    this.#bc.onmessage = (e: MessageEvent<ChannelMessage>) => {
      for (const handler of this.#handlers) handler(e.data);
    };
  }

  post(message: ChannelMessage) {
    this.#bc?.postMessage(message);
  }

  subscribe(handler: Handler) {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  close() {
    this.#handlers.clear();
    this.#bc?.close();
    this.#bc = null;
  }
}

let shared: Channel | null = null;

export function getChannel(): Channel {
  if (!shared) shared = new Channel();
  return shared;
}
