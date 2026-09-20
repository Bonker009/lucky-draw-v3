import type { StoredEvent } from "@/lib/domain/types";

export const CHANNEL_NAME = "lucky-draw-v3";

/** Commands travel control -> stage. The stage is the only writer. */
export type Command =
  | { kind: "cmd:draw"; prizeId: string; count: number }
  | { kind: "cmd:stop" }
  | { kind: "cmd:undo" }
  | { kind: "cmd:selectPrize"; prizeId: string }
  | { kind: "cmd:nextPrize" }
  | { kind: "cmd:setSound"; enabled: boolean }
  | { kind: "cmd:dismissWinner" }
  /**
   * Put the photo-call board on the projector: every winner of one prize, or
   * of the whole event, at once. `scope` is a prize id, or "all".
   */
  | { kind: "cmd:showRoster"; scope: string }
  | { kind: "cmd:hideRoster" }
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
