import { assertBatchValid, fold, InvariantError } from "./events";
import { Rng } from "./rng";
import { eligibleParticipants, remainingFor } from "./selectors";
import type { DrawEvent, DrawState, StoredEvent } from "./types";

export interface DrawPlan {
  prizeId: string;
  /** Participant ids, in the order they will be revealed. */
  winners: string[];
  /** The WINNER_DRAWN events that produce exactly these winners. */
  events: DrawEvent[];
}

/**
 * Decide the winners. Pure: same state plus same nonce gives the same answer,
 * every time, on any machine.
 *
 * Nothing here touches the DOM, React, the clock or a global RNG. The reel
 * animation is handed the result and only reveals it — which is the inversion
 * that makes "announced on stage but never saved" unrepresentable.
 */
export function computeDraw(
  state: DrawState,
  prizeId: string,
  requested: number,
): DrawPlan {
  const prize = state.prizesById.get(prizeId);
  if (!prize) throw new InvariantError(`Unknown prize ${prizeId}.`);

  const remaining = remainingFor(state, prizeId);
  if (remaining <= 0) {
    throw new InvariantError(`"${prize.name}" has already been fully awarded.`);
  }

  const pool = eligibleParticipants(state);
  if (pool.length === 0) {
    throw new InvariantError("Every participant has already won something.");
  }

  const count = Math.min(requested, remaining, pool.length);
  if (count <= 0) throw new InvariantError("Nothing left to draw.");

  const candidates = pool.map((p) => p.id);
  const winners: string[] = [];
  const events: DrawEvent[] = [];

  for (let i = 0; i < count; i++) {
    const nonce = state.drawCount + i;
    const rng = new Rng(state.settings.seed, nonce);
    const index = rng.nextBelow(candidates.length);
    const participantId = candidates[index];

    // splice, not swap-remove. The order of the remaining pool has to match
    // what a replay sees when it rebuilds eligibility from the folded state
    // in roster order, or the draw stops being verifiable.
    candidates.splice(index, 1);

    winners.push(participantId);
    events.push({ type: "WINNER_DRAWN", prizeId, participantId, nonce });
  }

  // Belt and braces: the plan must survive the same validation the store runs.
  assertBatchValid(state, events);

  return { prizeId, winners, events };
}

/**
 * Replay a log from scratch and confirm every recorded winner is exactly the
 * one the seed produces. Backs the "Verify" button.
 */
export function verifyLog(events: StoredEvent[]): {
  ok: boolean;
  checked: number;
  firstMismatch?: { seq: number; expected: string; recorded: string };
} {
  let state = fold([]);
  let checked = 0;

  for (const stored of events) {
    if (stored.event.type === "WINNER_DRAWN") {
      const pool = eligibleParticipants(state).map((p) => p.id);
      const rng = new Rng(state.settings.seed, stored.event.nonce);
      const expected = pool[rng.nextBelow(pool.length)];
      checked++;
      if (expected !== stored.event.participantId) {
        return {
          ok: false,
          checked,
          firstMismatch: {
            seq: stored.seq,
            expected,
            recorded: stored.event.participantId,
          },
        };
      }
    }
    state = fold([stored], state);
  }

  return { ok: true, checked };
}
