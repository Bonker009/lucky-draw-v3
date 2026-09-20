"use client";

import { create } from "zustand";
import { assertBatchValid, fold, initialState } from "@/lib/domain/events";
import type { DrawEvent, DrawState, StoredEvent } from "@/lib/domain/types";
import { getChannel } from "@/lib/channel";
import {
  appendEvents,
  clearEvents,
  deleteEventsFrom,
  loadEvents,
  SeqCollisionError,
} from "@/lib/persist/db";

interface EventStore {
  state: DrawState;
  log: StoredEvent[];
  ready: boolean;
  /** Set when a commit is rejected, so the operator sees why. */
  lastError: string | null;
  /** True in rehearsal: commits stay in memory and are never persisted. */
  rehearsal: boolean;

  load: () => Promise<void>;
  commit: (events: DrawEvent[]) => Promise<StoredEvent[]>;
  undoLast: () => Promise<void>;
  applyRemote: (events: StoredEvent[]) => void;
  clearError: () => void;
  enterRehearsal: () => void;
  exitRehearsal: () => Promise<void>;
  replaceLog: (events: StoredEvent[]) => Promise<void>;
}

/**
 * Commits run one at a time.
 *
 * Note what does NOT gate this: the writer lease. The lease decides who may
 * *draw* — two windows drawing at once is the duplicate-winner scenario. It
 * deliberately does not gate ordinary edits, because blocking the setup
 * window whenever a stage window happens to be open makes the app unusable
 * for the thing people actually do between prizes. Concurrent edits are safe
 * here on their own terms: commits are serialized per tab, IndexedDB rejects
 * a sequence collision instead of overwriting, and the loser reloads and
 * retries against the real head of the log.
 *
 * `commit` has an await in the middle of a read-modify-write. Without this
 * chain, two overlapping calls both read the same log, both compute the same
 * next sequence number, and the second silently overwrites the first — which
 * would put us right back in v2 territory, losing a winner that had already
 * been announced.
 */
let commitChain: Promise<unknown> = Promise.resolve();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = commitChain.then(work, work);
  // Keep the chain alive even when a commit rejects.
  commitChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export const useEventStore = create<EventStore>((set, get) => ({
  state: initialState(),
  log: [],
  ready: false,
  lastError: null,
  rehearsal: false,

  load: async () => {
    const log = await loadEvents();
    set({ log, state: fold(log), ready: true });
  },

  /**
   * The only write path in the app.
   *
   * Validate the whole batch, persist it in one transaction, then apply it.
   * If validation throws, nothing is stored and nothing is shown.
   */
  commit: async (events) =>
    serialize(async () => {
      const { rehearsal } = get();

      // Read inside the critical section, never from a snapshot taken before
      // an await.
      const attempt = async (): Promise<StoredEvent[]> => {
        const { state, log } = get();

        try {
          assertBatchValid(state, events);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Rejected an invalid change.";
          set({ lastError: message });
          throw error;
        }

        const baseSeq = log.length > 0 ? log[log.length - 1].seq + 1 : 0;
        const at = Date.now();
        const stored: StoredEvent[] = events.map((event, i) => ({
          seq: baseSeq + i,
          at,
          event,
        }));

        if (!rehearsal) {
          // Uses add(), not put(): a sequence collision must fail loudly
          // rather than overwrite somebody else's committed winner.
          await appendEvents(stored);
        }

        set({
          log: [...get().log, ...stored],
          state: fold(stored, get().state),
          lastError: null,
        });

        if (!rehearsal) {
          getChannel().post({ kind: "evt:committed", events: stored });
        }
        return stored;
      };

      try {
        return await attempt();
      } catch (error) {
        if (!(error instanceof SeqCollisionError)) throw error;
        // Another window got there first. Take on its writes, then retry once
        // against the real head of the log.
        await get().load();
        return attempt();
      }
    }),

  /** Drop the most recent WINNER_DRAWN and everything after it. */
  undoLast: async () =>
    serialize(async () => {
      const { log, rehearsal } = get();

      let cut = -1;
      for (let i = log.length - 1; i >= 0; i--) {
        if (log[i].event.type === "WINNER_DRAWN") {
          cut = i;
          break;
        }
      }
      if (cut === -1) return;

      const next = log.slice(0, cut);
      if (!rehearsal) {
        await deleteEventsFrom(log[cut].seq);
      }
      set({ log: next, state: fold(next), lastError: null });
      if (!rehearsal) {
        getChannel().post({ kind: "evt:reloaded" });
      }
    }),

  /** Fold in what another window committed. */
  applyRemote: (events) => {
    const { log, rehearsal } = get();
    if (rehearsal) return;

    const known = log.length > 0 ? log[log.length - 1].seq : -1;
    const fresh = events.filter((e) => e.seq > known);
    if (fresh.length === 0) return;

    // A gap means we missed a broadcast (a throttled background tab). Folding
    // a log with holes would show the wrong eligibility for the rest of the
    // event, so reload the whole thing instead.
    if (fresh[0].seq !== known + 1) {
      void get().load();
      return;
    }

    set({ log: [...log, ...fresh], state: fold(fresh, get().state) });
  },

  clearError: () => set({ lastError: null }),

  enterRehearsal: () => set({ rehearsal: true }),

  /** Throw away everything the rehearsal did and reload the real log. */
  exitRehearsal: async () => {
    set({ rehearsal: false });
    await get().load();
  },

  replaceLog: async (events) =>
    serialize(async () => {
      await clearEvents();
      await appendEvents(events);
      set({ log: events, state: fold(events), lastError: null });
      getChannel().post({ kind: "evt:reloaded" });
    }),
}));

/**
 * Keep every window's log current, whoever wrote it.
 *
 * Subscribed once at module level rather than per page: a window whose log
 * goes stale will compute a sequence number that is already taken, and before
 * the collision check existed that overwrote committed winners.
 */
if (typeof window !== "undefined") {
  getChannel().subscribe((message) => {
    if (message.kind === "evt:committed") {
      useEventStore.getState().applyRemote(message.events);
    } else if (message.kind === "evt:reloaded") {
      void useEventStore.getState().load();
    }
  });
}
