/**
 * The photo session's presentation state: which mode the projector is in,
 * which group is being called, and who has come up.
 *
 * Deliberately not in the event log. Checking someone in changes nothing about
 * who won, so it cannot affect fairness or `verifyLog`; it lives in the stage's
 * memory and is mirrored to the remote over the channel. A reload of the stage
 * starts the check-in again, which is the right failure for a group photo.
 *
 * A no-show is only marked. Redrawing their place would be a fairness decision
 * (and a new event in the log), not a presentation one.
 */

import type { DrawState } from "@/lib/domain/types";

/** Photos are taken in batches of at most this many people. */
export const PHOTO_GROUP_SIZE = 10;

/**
 * `call`: names on screen, numbered, so the group finds itself and comes up.
 * `backdrop`: the screen is behind the group in the photo — prize and
 * "Winners" up top, nothing in the lower two-thirds that heads would cut.
 */
export type PhotoMode = "call" | "backdrop";

export interface PhotoState {
  mode: PhotoMode;
  /** 0-based group index. */
  group: number;
  /** Participant ids checked in as on stage. */
  here: string[];
  /** Participant ids marked as not here. */
  absent: string[];
}

export const PHOTO_INITIAL: PhotoState = { mode: "call", group: 0, here: [], absent: [] };

export type PhotoAction =
  | { type: "mode"; mode: PhotoMode }
  | { type: "group"; group: number }
  | { type: "here"; participantId: string; here: boolean }
  | { type: "absent"; participantId: string; absent: boolean }
  /** Everyone in the current group who is not marked absent. */
  | { type: "allHere" };

export interface RosterEntry {
  participantId: string;
  name: string;
  /** 1-based number in the whole roster, continuous across groups. */
  n: number;
}

/** Everyone in a photo call, in draw order. `scope` is a prize id or "all". */
export function photoRoster(state: DrawState, scope: string, all = "all"): RosterEntry[] {
  const rows = scope === all ? state.winners : state.winners.filter((w) => w.prizeId === scope);
  return rows.map((w, i) => ({
    participantId: w.participantId,
    name: state.participantsById.get(w.participantId)?.name ?? w.participantId,
    n: i + 1,
  }));
}

export function groupCount(total: number): number {
  return Math.max(1, Math.ceil(total / PHOTO_GROUP_SIZE));
}

export function clampGroup(group: number, total: number): number {
  return Math.min(Math.max(0, Math.floor(group)), groupCount(total) - 1);
}

export function groupSlice<T>(entries: T[], group: number): T[] {
  const g = clampGroup(group, entries.length);
  return entries.slice(g * PHOTO_GROUP_SIZE, (g + 1) * PHOTO_GROUP_SIZE);
}

/**
 * Apply a remote's request. A channel message is just data — any tab on the
 * origin can post one — so every field is checked against the roster that is
 * actually up, and anything else is ignored.
 */
export function applyPhotoAction(
  photo: PhotoState,
  action: unknown,
  roster: readonly RosterEntry[],
): PhotoState {
  if (!action || typeof action !== "object") return photo;
  const a = action as Record<string, unknown>;
  const ids = new Set(roster.map((r) => r.participantId));
  const without = (list: string[], id: string) => list.filter((x) => x !== id);

  switch (a.type) {
    case "mode":
      return a.mode === "call" || a.mode === "backdrop" ? { ...photo, mode: a.mode } : photo;
    case "group":
      return typeof a.group === "number" && Number.isFinite(a.group)
        ? { ...photo, group: clampGroup(a.group, roster.length) }
        : photo;
    case "here": {
      const id = a.participantId;
      if (typeof id !== "string" || !ids.has(id) || typeof a.here !== "boolean") return photo;
      // Turning up clears a no-show; being sent back does not invent one.
      return a.here
        ? { ...photo, here: [...without(photo.here, id), id], absent: without(photo.absent, id) }
        : { ...photo, here: without(photo.here, id) };
    }
    case "absent": {
      const id = a.participantId;
      if (typeof id !== "string" || !ids.has(id) || typeof a.absent !== "boolean") return photo;
      return a.absent
        ? { ...photo, absent: [...without(photo.absent, id), id], here: without(photo.here, id) }
        : { ...photo, absent: without(photo.absent, id) };
    }
    case "allHere": {
      const absent = new Set(photo.absent);
      const add = groupSlice([...roster], photo.group)
        .map((r) => r.participantId)
        .filter((id) => !absent.has(id) && !photo.here.includes(id));
      return { ...photo, here: [...photo.here, ...add] };
    }
    default:
      return photo;
  }
}
