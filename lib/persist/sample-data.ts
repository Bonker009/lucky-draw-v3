import type { DrawEvent, Participant, Prize } from "@/lib/domain/types";
import { generateSeed } from "@/lib/domain/rng";

const GIVEN = [
  "Sokha", "Dara", "Bopha", "Vichea", "Chantha", "Sreymom", "Rithy", "Kanha",
  "Piseth", "Sothea", "Molika", "Veasna", "Chenda", "Samnang", "Nary",
  "Thida", "Rattana", "Sovann", "Mealea", "Punleu", "Sophal", "Davy",
  "Kimly", "Seyha", "Borey", "Leakhena", "Visal", "Phalla", "Narith", "Sida",
];

const FAMILY = [
  "Chan", "Sok", "Kim", "Ly", "Meas", "Nhem", "Ouk", "Pich", "Sam", "Tep",
  "Yim", "Heng", "Long", "Mao", "Ros", "Sean", "Uch", "Vong",
];

const TEAMS = ["Web", "Mobile", "Data", "Design", "Ops", "QA"];

/**
 * Plausible-looking participants for rehearsal.
 *
 * Deliberately generated rather than shipped as a fixture: it costs no bundle
 * size, scales to whatever headcount the real event will be, and the names
 * exercise the same non-ASCII-adjacent widths the real roster will have.
 */
export function generateParticipants(count: number): Participant[] {
  return Array.from({ length: count }, (_, i) => ({
    // Names repeat once the combinations run out, exactly as a real roster
    // does. Ids stay unique, which is the whole reason identity is not the
    // display name here.
    id: `demo-${i}`,
    name: `${GIVEN[i % GIVEN.length]} ${
      FAMILY[Math.floor(i / GIVEN.length) % FAMILY.length]
    }`,
    meta: {
      Team: TEAMS[i % TEAMS.length],
      Seat: String(101 + i),
    },
  }));
}

export const SAMPLE_PRIZES: Omit<Prize, "id">[] = [
  { name: "Grand Prize — Motorbike", quantity: 1 },
  { name: "Second Prize — Smartphone", quantity: 3 },
  { name: "Third Prize — Headphones", quantity: 10 },
  { name: "Consolation — Gift Voucher", quantity: 25 },
];

/**
 * A complete, ready-to-run demo event: roster, prizes, order and a seed.
 * Pair it with rehearsal mode to practise the whole show end to end.
 */
export function sampleEventEvents(participantCount = 250): DrawEvent[] {
  const prizes: Prize[] = SAMPLE_PRIZES.map((p, i) => ({
    ...p,
    id: `demo-prize-${i}`,
  }));

  return [
    {
      type: "PARTICIPANTS_SET",
      participants: generateParticipants(participantCount),
    },
    ...prizes.map(
      (prize): DrawEvent => ({ type: "PRIZE_UPSERTED", prize }),
    ),
    {
      type: "SETTINGS_PATCHED",
      patch: {
        eventName: "Sample Event",
        seed: generateSeed(),
        prizeOrder: prizes.map((p) => p.id),
      },
    },
  ];
}
