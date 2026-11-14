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

export const SAMPLE_PRIZES: (Omit<Prize, "id"> & { photo: string })[] = [
  { name: "Grand Prize — Motorbike", quantity: 1, photo: "/sample-prizes/motorbike.jpg" },
  { name: "Second Prize — Smartphone", quantity: 3, photo: "/sample-prizes/smartphone.jpg" },
  { name: "Third Prize — Headphones", quantity: 10, photo: "/sample-prizes/headphones.jpg" },
  { name: "Consolation — Gift Voucher", quantity: 25, photo: "/sample-prizes/gift.jpg" },
];

/**
 * Store the bundled sample photos as image assets, in `SAMPLE_PRIZES` order.
 *
 * Real photos rather than empty tiles, because the sample event exists to
 * rehearse the show — and the photo session, the one screen that shows prize
 * art, looks broken with nothing in it. They go through `storeImage` exactly
 * like an operator's upload, so the rehearsal exercises the real path.
 *
 * A photo that fails to load (served from somewhere without `public/`) just
 * leaves that prize without an image, as before — a demo must never fail to
 * load over artwork. Licences: `public/sample-prizes/CREDITS.md`.
 */
export async function loadSamplePrizePhotos(
  store: (file: File) => Promise<string>,
): Promise<(string | undefined)[]> {
  return Promise.all(
    SAMPLE_PRIZES.map(async ({ photo }) => {
      try {
        const res = await fetch(photo);
        if (!res.ok) return undefined;
        const blob = await res.blob();
        const name = photo.split("/").pop() ?? "prize.jpg";
        return await store(new File([blob], name, { type: blob.type || "image/jpeg" }));
      } catch {
        return undefined;
      }
    }),
  );
}

/**
 * A complete, ready-to-run demo event: roster, prizes, order and a seed.
 * Pair it with rehearsal mode to practise the whole show end to end.
 * `photoIds` are asset ids from `loadSamplePrizePhotos`, in prize order.
 */
export function sampleEventEvents(
  participantCount = 250,
  photoIds: (string | undefined)[] = [],
): DrawEvent[] {
  const prizes: Prize[] = SAMPLE_PRIZES.map(({ name, quantity }, i) => ({
    name,
    quantity,
    id: `demo-prize-${i}`,
    ...(photoIds[i] ? { imageAssetId: photoIds[i] } : {}),
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
