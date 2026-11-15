/**
 * Announcing a prize on the stage before it is drawn for.
 *
 * Two beats, both driven by the presenter: `show` puts the prize up still
 * hidden ("Up next · 3 to be won"), `reveal` unveils it. Like the photo
 * session this is presentation state held by the stage — nothing is logged,
 * so it cannot touch who wins — and a draw always takes the screen back.
 */

import type { DrawState } from "@/lib/domain/types";

export interface PrizeShow {
  prizeId: string;
  /** False while the prize is announced but still covered. */
  revealed: boolean;
}

export type PrizeAction =
  /** Announce a prize, still covered. Defaults to the selected prize. */
  | { type: "show"; prizeId?: string }
  | { type: "reveal" }
  | { type: "hide" };

/**
 * Apply a remote's request. A channel message is just data, so the prize is
 * checked against the event and anything malformed is ignored.
 */
export function applyPrizeAction(
  current: PrizeShow | null,
  action: unknown,
  state: DrawState,
  selectedPrizeId: string | null,
): PrizeShow | null {
  if (!action || typeof action !== "object") return current;
  const a = action as Record<string, unknown>;
  switch (a.type) {
    case "show": {
      const id = typeof a.prizeId === "string" ? a.prizeId : selectedPrizeId;
      if (!id || !state.prizesById.has(id)) return current;
      return { prizeId: id, revealed: false };
    }
    case "reveal":
      return current ? { ...current, revealed: true } : current;
    case "hide":
      return null;
    default:
      return current;
  }
}
