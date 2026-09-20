import type { DrawState, Participant, Prize } from "./types";

/** Anyone who has not already won something. */
export function eligibleParticipants(state: DrawState): Participant[] {
  if (state.winnerByParticipant.size === 0) return state.participants;
  return state.participants.filter(
    (p) => !state.winnerByParticipant.has(p.id),
  );
}

export function remainingFor(state: DrawState, prizeId: string): number {
  const prize = state.prizesById.get(prizeId);
  if (!prize) return 0;
  return Math.max(0, prize.quantity - (state.awardedByPrize.get(prizeId) ?? 0));
}

export function awardedFor(state: DrawState, prizeId: string): number {
  return state.awardedByPrize.get(prizeId) ?? 0;
}

/** Prizes in presentation order: the configured order first, then the rest. */
export function orderedPrizes(state: DrawState): Prize[] {
  const order = state.settings.prizeOrder;
  if (order.length === 0) return state.prizes;
  const rank = new Map(order.map((id, i) => [id, i] as const));
  return [...state.prizes].sort(
    (a, b) =>
      (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

/** The next prize with stock left, for sequential mode. */
export function nextAvailablePrize(
  state: DrawState,
  afterPrizeId?: string,
): Prize | undefined {
  const prizes = orderedPrizes(state);
  const start = afterPrizeId
    ? prizes.findIndex((p) => p.id === afterPrizeId) + 1
    : 0;
  for (let i = start; i < prizes.length; i++) {
    if (remainingFor(state, prizes[i].id) > 0) return prizes[i];
  }
  // Wrap around, so finishing the last prize surfaces anything skipped.
  for (let i = 0; i < Math.min(start, prizes.length); i++) {
    if (remainingFor(state, prizes[i].id) > 0) return prizes[i];
  }
  return undefined;
}

export function winnersFor(state: DrawState, prizeId: string) {
  return state.winners.filter((w) => w.prizeId === prizeId);
}

/**
 * A name that is always safe to put on a projector.
 *
 * `?? participantId` is not enough: `??` only catches null and undefined, so
 * a participant imported with a blank name rendered as an empty row — a
 * winner with no visible name on the photo-call board. Blank falls through to
 * the id, which is ugly but traceable, and never silently empty.
 */
export function participantName(state: DrawState, participantId: string) {
  const name = state.participantsById.get(participantId)?.name?.trim();
  return name ? name : participantId;
}

export interface EventStats {
  totalParticipants: number;
  eligible: number;
  totalPrizes: number;
  totalSlots: number;
  awarded: number;
  remaining: number;
}

export function eventStats(state: DrawState): EventStats {
  const totalSlots = state.prizes.reduce((sum, p) => sum + p.quantity, 0);
  const awarded = state.winners.length;
  return {
    totalParticipants: state.participants.length,
    eligible: state.participants.length - state.winnerByParticipant.size,
    totalPrizes: state.prizes.length,
    totalSlots,
    awarded,
    remaining: totalSlots - awarded,
  };
}
