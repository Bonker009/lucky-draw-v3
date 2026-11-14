/**
 * Domain types for the lucky draw.
 *
 * The whole app is an append-only log of `DrawEvent`s. State is never mutated
 * in place and never overwritten wholesale — it is always `fold(events)`.
 * That is what makes a committed winner impossible to lose.
 */

export interface Participant {
  id: string;
  name: string;
  /** Optional extra columns from the imported spreadsheet, kept for display/export. */
  meta?: Record<string, string>;
}

export interface Prize {
  id: string;
  name: string;
  /** Key into the IndexedDB `assets` store, not a URL. */
  imageAssetId?: string;
  quantity: number;
}

/**
 * How the stage reveals a winner. Presentation only: every style reveals the
 * winner the engine already committed, so switching style can never change
 * who wins — only how the room finds out.
 */
export type DrawStyle = "wall" | "flap" | "envelope" | "letters" | "reel";

export const DRAW_STYLES: readonly DrawStyle[] = [
  "wall",
  "flap",
  "envelope",
  "letters",
  "reel",
];

export interface Settings {
  eventName: string;
  /** Seed for the deterministic RNG. Fixed before the event, shown in the commitment. */
  seed: string;
  spinDurationMs: number;
  /** How long a winner stays on screen before the next spin. */
  revealHoldMs: number;
  /** Stretch the spin for the final winners of a prize, for suspense. */
  suspenseScaling: boolean;
  soundEnabled: boolean;
  backgroundAssetId?: string;
  winAudioAssetId?: string;
  /** Prize ids in presentation order. Ids not listed fall to the end. */
  prizeOrder: string[];
  reducedMotionOverride: boolean;
  /** Absent in logs written before draw styles existed; folds to "wall". */
  drawStyle: DrawStyle;
}

export const DEFAULT_SETTINGS: Settings = {
  eventName: "Lucky Draw",
  seed: "",
  spinDurationMs: 5000,
  revealHoldMs: 2500,
  suspenseScaling: true,
  soundEnabled: true,
  prizeOrder: [],
  reducedMotionOverride: false,
  drawStyle: "wall",
};

/**
 * Every mutation is one of these. `seq` is assigned by the store on commit and
 * is strictly increasing; `at` is wall-clock and is for display only.
 */
export type DrawEvent =
  | { type: "PARTICIPANTS_SET"; participants: Participant[] }
  | { type: "PARTICIPANT_ADDED"; participant: Participant }
  | { type: "PARTICIPANT_REMOVED"; participantId: string }
  | { type: "PRIZE_UPSERTED"; prize: Prize }
  | { type: "PRIZE_REMOVED"; prizeId: string }
  | { type: "SETTINGS_PATCHED"; patch: Partial<Settings> }
  | {
      type: "WINNER_DRAWN";
      prizeId: string;
      participantId: string;
      /** Monotonic per-event-log counter fed into the RNG. Makes the draw replayable. */
      nonce: number;
    }
  | { type: "WINNER_REVOKED"; prizeId: string; participantId: string }
  | { type: "EVENT_RESET" };

export interface StoredEvent {
  seq: number;
  at: number;
  event: DrawEvent;
}

export interface Winner {
  prizeId: string;
  participantId: string;
  at: number;
  seq: number;
}

/** The folded state. Derived entirely from the log — never edited directly. */
export interface DrawState {
  participants: Participant[];
  participantsById: Map<string, Participant>;
  prizes: Prize[];
  prizesById: Map<string, Prize>;
  settings: Settings;
  winners: Winner[];
  /** participantId -> the winner record, for O(1) eligibility checks. */
  winnerByParticipant: Map<string, Winner>;
  /** prizeId -> number of winners committed so far. */
  awardedByPrize: Map<string, number>;
  /** Number of WINNER_DRAWN events ever committed; the RNG nonce source. */
  drawCount: number;
}
