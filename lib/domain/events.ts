import {
  DEFAULT_SETTINGS,
  type DrawEvent,
  type DrawState,
  type Participant,
  type Prize,
  type StoredEvent,
  type Winner,
} from "./types";

export function initialState(): DrawState {
  return {
    participants: [],
    participantsById: new Map(),
    prizes: [],
    prizesById: new Map(),
    settings: { ...DEFAULT_SETTINGS },
    winners: [],
    winnerByParticipant: new Map(),
    awardedByPrize: new Map(),
    drawCount: 0,
  };
}

function indexParticipants(participants: Participant[]) {
  return new Map(participants.map((p) => [p.id, p] as const));
}

function indexPrizes(prizes: Prize[]) {
  return new Map(prizes.map((p) => [p.id, p] as const));
}

function indexWinners(winners: Winner[]) {
  return new Map(winners.map((w) => [w.participantId, w] as const));
}

/**
 * Apply one event. Returns a new state object; never mutates the input.
 *
 * This is the only place state changes shape. Nothing else in the app writes
 * to a DrawState.
 */
export function applyEvent(state: DrawState, stored: StoredEvent): DrawState {
  const { event, seq, at } = stored;

  switch (event.type) {
    case "PARTICIPANTS_SET": {
      const participants = event.participants;
      return {
        ...state,
        participants,
        participantsById: indexParticipants(participants),
      };
    }

    case "PARTICIPANT_ADDED": {
      if (state.participantsById.has(event.participant.id)) return state;
      const participants = [...state.participants, event.participant];
      return {
        ...state,
        participants,
        participantsById: indexParticipants(participants),
      };
    }

    case "PARTICIPANT_REMOVED": {
      if (!state.participantsById.has(event.participantId)) return state;
      const participants = state.participants.filter(
        (p) => p.id !== event.participantId,
      );
      return {
        ...state,
        participants,
        participantsById: indexParticipants(participants),
      };
    }

    case "PRIZE_UPSERTED": {
      const exists = state.prizesById.has(event.prize.id);
      const prizes = exists
        ? state.prizes.map((p) => (p.id === event.prize.id ? event.prize : p))
        : [...state.prizes, event.prize];
      return { ...state, prizes, prizesById: indexPrizes(prizes) };
    }

    case "PRIZE_REMOVED": {
      if (!state.prizesById.has(event.prizeId)) return state;
      const prizes = state.prizes.filter((p) => p.id !== event.prizeId);
      const awardedByPrize = new Map(state.awardedByPrize);
      awardedByPrize.delete(event.prizeId);
      const winners = state.winners.filter((w) => w.prizeId !== event.prizeId);
      return {
        ...state,
        prizes,
        prizesById: indexPrizes(prizes),
        awardedByPrize,
        winners,
        winnerByParticipant: indexWinners(winners),
        settings: {
          ...state.settings,
          prizeOrder: state.settings.prizeOrder.filter(
            (id) => id !== event.prizeId,
          ),
        },
      };
    }

    case "SETTINGS_PATCHED":
      return { ...state, settings: { ...state.settings, ...event.patch } };

    case "WINNER_DRAWN": {
      const winner: Winner = {
        prizeId: event.prizeId,
        participantId: event.participantId,
        at,
        seq,
      };
      const winners = [...state.winners, winner];
      const winnerByParticipant = new Map(state.winnerByParticipant);
      winnerByParticipant.set(event.participantId, winner);
      const awardedByPrize = new Map(state.awardedByPrize);
      awardedByPrize.set(
        event.prizeId,
        (awardedByPrize.get(event.prizeId) ?? 0) + 1,
      );
      return {
        ...state,
        winners,
        winnerByParticipant,
        awardedByPrize,
        drawCount: state.drawCount + 1,
      };
    }

    case "WINNER_REVOKED": {
      const idx = state.winners.findIndex(
        (w) =>
          w.prizeId === event.prizeId && w.participantId === event.participantId,
      );
      if (idx === -1) return state;
      const winners = state.winners.filter((_, i) => i !== idx);
      const awardedByPrize = new Map(state.awardedByPrize);
      awardedByPrize.set(
        event.prizeId,
        Math.max(0, (awardedByPrize.get(event.prizeId) ?? 0) - 1),
      );
      return {
        ...state,
        winners,
        winnerByParticipant: indexWinners(winners),
        awardedByPrize,
        // drawCount is deliberately NOT decremented. It is the RNG nonce
        // source, and reusing a nonce would make a re-draw after a revoke
        // reproduce the exact pick it was meant to replace.
      };
    }

    case "EVENT_RESET": {
      const fresh = initialState();
      // Keep roster, prizes and settings; clear only results.
      return {
        ...fresh,
        participants: state.participants,
        participantsById: state.participantsById,
        prizes: state.prizes,
        prizesById: state.prizesById,
        settings: state.settings,
        drawCount: state.drawCount,
      };
    }
  }
}

export function fold(events: StoredEvent[], from = initialState()): DrawState {
  return events.reduce(applyEvent, from);
}

export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvariantError";
  }
}

/**
 * Validate a whole batch against the current state before anything is applied,
 * persisted or shown on the projector.
 *
 * v2 announced a winner and only then tried to save it. If the save lost a
 * race, the name stayed eligible and could be drawn again. Here an invalid
 * batch throws and nothing reaches the screen.
 */
export function assertBatchValid(state: DrawState, events: DrawEvent[]): void {
  // Simulate the batch so intra-batch conflicts are caught as well.
  const seenWinners = new Set(state.winnerByParticipant.keys());
  const awarded = new Map(state.awardedByPrize);
  const quantities = new Map(state.prizes.map((p) => [p.id, p.quantity]));
  const known = new Set(state.participantsById.keys());

  for (const event of events) {
    switch (event.type) {
      case "PRIZE_UPSERTED": {
        const already = awarded.get(event.prize.id) ?? 0;
        if (event.prize.quantity < already) {
          throw new InvariantError(
            `Cannot set "${event.prize.name}" to ${event.prize.quantity}: ${already} already awarded.`,
          );
        }
        quantities.set(event.prize.id, event.prize.quantity);
        break;
      }

      case "PARTICIPANT_ADDED":
        known.add(event.participant.id);
        break;

      case "PARTICIPANTS_SET": {
        for (const w of seenWinners) {
          if (!event.participants.some((p) => p.id === w)) {
            throw new InvariantError(
              "Replacing the roster would erase a participant who has already won.",
            );
          }
        }
        known.clear();
        for (const p of event.participants) known.add(p.id);
        break;
      }

      case "PARTICIPANT_REMOVED":
        if (seenWinners.has(event.participantId)) {
          throw new InvariantError(
            "Cannot remove a participant who has already won. Revoke the win first.",
          );
        }
        known.delete(event.participantId);
        break;

      case "WINNER_DRAWN": {
        if (!known.has(event.participantId)) {
          throw new InvariantError(
            `Unknown participant ${event.participantId} cannot win.`,
          );
        }
        if (seenWinners.has(event.participantId)) {
          throw new InvariantError(
            `${event.participantId} has already won and cannot win again.`,
          );
        }
        const quantity = quantities.get(event.prizeId);
        if (quantity === undefined) {
          throw new InvariantError(`Unknown prize ${event.prizeId}.`);
        }
        const next = (awarded.get(event.prizeId) ?? 0) + 1;
        if (next > quantity) {
          throw new InvariantError(
            `Prize ${event.prizeId} only has ${quantity} to give; this draw would award ${next}.`,
          );
        }
        seenWinners.add(event.participantId);
        awarded.set(event.prizeId, next);
        break;
      }

      case "PRIZE_REMOVED": {
        // Without this, deleting a prize quietly erases its winners from the
        // folded state and makes those people eligible again — the same
        // duplicate-winner outcome the roster guards above prevent, reached
        // by a different door.
        if ((awarded.get(event.prizeId) ?? 0) > 0) {
          throw new InvariantError(
            "That prize already has winners. Revoke them before deleting it.",
          );
        }
        quantities.delete(event.prizeId);
        break;
      }

      case "WINNER_REVOKED":
        seenWinners.delete(event.participantId);
        awarded.set(
          event.prizeId,
          Math.max(0, (awarded.get(event.prizeId) ?? 0) - 1),
        );
        break;

      case "EVENT_RESET":
        seenWinners.clear();
        awarded.clear();
        break;

      case "SETTINGS_PATCHED":
        break;
    }
  }
}
