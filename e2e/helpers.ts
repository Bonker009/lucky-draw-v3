import type { Page } from "@playwright/test";

export interface SeedOptions {
  participants: number;
  prizes: { name: string; quantity: number }[];
  spinDurationMs?: number;
  revealHoldMs?: number;
  seed?: string;
}

/**
 * Write a starting event log straight into IndexedDB.
 *
 * Seeding through the UI would work but takes minutes for 500 names, and
 * these tests are about the draw, not the import form (which has its own
 * test below).
 */
export async function seedEvent(page: Page, options: SeedOptions) {
  // A route that renders not-found: same origin, but it never mounts the
  // store, so nothing is racing us for the database while we reset it.
  await page.goto("/__seed__");
  await page.evaluate(async (opts) => {
    const DB_NAME = "lucky-draw-v3";

    // Clear the stores rather than deleting the database. deleteDatabase is
    // blocked whenever any other tab still holds a connection, and its
    // onblocked path used to leave the previous test's events in place —
    // which made the whole suite flaky when run repeatedly.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains("events")) {
          d.createObjectStore("events", { keyPath: "seq" });
        }
        if (!d.objectStoreNames.contains("assets")) {
          d.createObjectStore("assets", { keyPath: "id" });
        }
        if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["events", "assets"], "readwrite");
      tx.objectStore("events").clear();
      tx.objectStore("assets").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    localStorage.removeItem("lucky-draw-v3:writer-lease");

    const events: unknown[] = [];
    let seq = 0;
    const at = Date.now();
    const push = (event: unknown) => events.push({ seq: seq++, at, event });

    push({
      type: "PARTICIPANTS_SET",
      participants: Array.from({ length: opts.participants }, (_, i) => ({
        id: `p${i}`,
        name: `Guest ${String(i).padStart(4, "0")}`,
      })),
    });
    push({
      type: "SETTINGS_PATCHED",
      patch: {
        eventName: "E2E Event",
        seed: opts.seed ?? "e2e-fixed-seed",
        spinDurationMs: opts.spinDurationMs ?? 400,
        revealHoldMs: opts.revealHoldMs ?? 400,
        suspenseScaling: false,
        soundEnabled: false,
      },
    });
    opts.prizes.forEach((prize, i) => {
      push({
        type: "PRIZE_UPSERTED",
        prize: { id: `z${i}`, name: prize.name, quantity: prize.quantity },
      });
    });
    push({
      type: "SETTINGS_PATCHED",
      patch: { prizeOrder: opts.prizes.map((_, i) => `z${i}`) },
    });

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("events", "readwrite");
      const store = tx.objectStore("events");
      for (const e of events) store.put(e);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, options);
}

/** Winner count as the stage reports it. */
export async function winnerCount(page: Page): Promise<number> {
  const text = await page
    .locator("text=/^Winners · \\d+$/")
    .first()
    .textContent()
    .catch(() => null);
  if (!text) return 0;
  return Number(text.replace(/\D+/g, ""));
}

/** Read the committed log straight from IndexedDB. */
export async function readLog(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("lucky-draw-v3", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const events = await new Promise<
      { seq: number; event: { type: string; participantId?: string } }[]
    >((resolve, reject) => {
      const tx = db.transaction("events", "readonly");
      const req = tx.objectStore("events").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return events;
  });
}

export async function drawnWinnerIds(page: Page): Promise<string[]> {
  const log = await readLog(page);
  return log
    .filter((e) => e.event.type === "WINNER_DRAWN")
    .map((e) => e.event.participantId as string);
}
