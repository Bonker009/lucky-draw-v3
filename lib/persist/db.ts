import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { StoredEvent } from "@/lib/domain/types";

export const DB_NAME = "lucky-draw-v3";
const DB_VERSION = 1;

export interface StoredAsset {
  id: string;
  kind: "image" | "audio";
  blob: Blob;
  name: string;
  at: number;
}

interface LuckyDrawDB extends DBSchema {
  events: { key: number; value: StoredEvent };
  assets: { key: string; value: StoredAsset };
  meta: { key: string; value: unknown };
}

let dbPromise: Promise<IDBPDatabase<LuckyDrawDB>> | null = null;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<LuckyDrawDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore("events", { keyPath: "seq" });
        db.createObjectStore("assets", { keyPath: "id" });
        db.createObjectStore("meta");
      },
    });
  }
  return dbPromise;
}

export async function loadEvents(): Promise<StoredEvent[]> {
  const db = await getDB();
  const events = await db.getAll("events");
  return events.sort((a, b) => a.seq - b.seq);
}

export class SeqCollisionError extends Error {
  constructor(readonly seq: number) {
    super(`Sequence ${seq} is already taken.`);
    this.name = "SeqCollisionError";
  }
}

/**
 * Append a batch in a single transaction. Either the whole draw lands or none
 * of it does — there is no half-saved state to reconcile later.
 *
 * Uses add(), not put(). With put(), a window working from a stale log would
 * silently overwrite a committed winner with its own event at the same
 * sequence number. add() rejects instead, and the caller reloads and retries.
 */
export async function appendEvents(events: StoredEvent[]): Promise<void> {
  if (events.length === 0) return;
  const db = await getDB();
  const tx = db.transaction("events", "readwrite");
  try {
    await Promise.all(events.map((e) => tx.store.add(e)));
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // Already aborted by the failed add.
    }
    if (
      error instanceof DOMException &&
      (error.name === "ConstraintError" || error.name === "AbortError")
    ) {
      throw new SeqCollisionError(events[0].seq);
    }
    throw error;
  }
}

export async function deleteEventsFrom(seq: number): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("events", "readwrite");
  await tx.store.delete(IDBKeyRange.lowerBound(seq));
  await tx.done;
}

export async function clearEvents(): Promise<void> {
  const db = await getDB();
  await db.clear("events");
}

export async function putAsset(asset: StoredAsset): Promise<void> {
  const db = await getDB();
  await db.put("assets", asset);
}

export async function getAsset(id: string): Promise<StoredAsset | undefined> {
  const db = await getDB();
  return db.get("assets", id);
}

export async function getAllAssets(): Promise<StoredAsset[]> {
  const db = await getDB();
  return db.getAll("assets");
}

export async function deleteAsset(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("assets", id);
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await getDB();
  return (await db.get("meta", key)) as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await db.put("meta", value, key);
}
