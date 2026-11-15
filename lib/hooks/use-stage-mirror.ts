"use client";

import { useEffect, useState } from "react";
import { getChannel, type ChannelMessage } from "@/lib/channel";
import type { PhotoState } from "@/lib/stage/photo-session";
import type { PrizeShow } from "@/lib/stage/prize-show";
import { useEventStore } from "@/lib/store/event-store";

export interface StageMirror {
  phase: string;
  revealed: string | null;
  pending: number;
  prizeId?: string;
  /** Which photo-call board the stage currently has up, if any. */
  roster: string | null;
  /** Mode, group and check-ins of the photo session, while a board is up. */
  photo: PhotoState | null;
  /** The prize announced on the projector, if any. */
  prizeShow: PrizeShow | null;
  /** Winners the projector has revealed, in log order. See `evt:phase`. */
  shown: number | null;
  seenAt: number;
}

/**
 * `none`: no stage has ever answered. `lost`: one did, but has stopped.
 * `linked`: it answered within the last few polls.
 */
export type StageLink = "none" | "lost" | "linked";

const POLL_MS = 2000;
/** Two and a half missed polls. One late reply is not an outage. */
const LOST_AFTER_MS = 5000;

/**
 * What the projector is showing, as the control window sees it.
 *
 * BroadcastChannel says nothing when the other end goes away, so liveness is
 * inferred: we keep asking for a snapshot and treat silence as a lost stage.
 * Without that the remote kept saying "Stage linked" after the projector tab
 * was closed, and Draw looked live while posting into the void.
 */
export function useStageMirror() {
  const { load, applyRemote } = useEventStore();
  const [mirror, setMirror] = useState<StageMirror | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const channel = getChannel();
    const unsubscribe = channel.subscribe((message: ChannelMessage) => {
      if (message.kind === "evt:phase") {
        const seenAt = Date.now();
        setMirror({
          phase: message.phase,
          revealed: message.revealed ?? null,
          pending: message.pending,
          prizeId: message.prizeId,
          roster: message.roster ?? null,
          photo: message.photo ?? null,
          prizeShow: message.prizeShow ?? null,
          shown: message.shown ?? null,
          seenAt,
        });
        setNow(seenAt);
      } else if (message.kind === "evt:committed") {
        applyRemote(message.events);
      } else if (message.kind === "evt:reloaded") {
        void load();
      }
    });

    // Ask the stage where it is; it may have been open long before us.
    channel.post({ kind: "cmd:requestSnapshot" });
    const poll = setInterval(() => {
      channel.post({ kind: "cmd:requestSnapshot" });
      setNow(Date.now());
    }, POLL_MS);

    return () => {
      unsubscribe();
      clearInterval(poll);
    };
  }, [applyRemote, load]);

  const link: StageLink = !mirror
    ? "none"
    : now - mirror.seenAt > LOST_AFTER_MS
      ? "lost"
      : "linked";

  return { mirror, link, now };
}
