import type { DrawState, StoredEvent } from "@/lib/domain/types";
import { fold } from "@/lib/domain/events";
import { participantName } from "@/lib/domain/selectors";
import { getAllAssets, putAsset } from "./db";

export const BUNDLE_VERSION = 3;

export interface Bundle {
  version: number;
  exportedAt: string;
  eventName: string;
  log: StoredEvent[];
  assets: { id: string; kind: string; name: string; dataUrl: string }[];
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

/**
 * The full event, in one file: the log plus every uploaded asset.
 *
 * This is the durability story now that there is no server. Because the log
 * is the source of truth, restoring a bundle reproduces the event exactly,
 * including the order winners were drawn in.
 */
export async function exportBundle(
  log: StoredEvent[],
  eventName: string,
): Promise<Bundle> {
  const assets = await getAllAssets();
  return {
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    eventName,
    log,
    assets: await Promise.all(
      assets.map(async (a) => ({
        id: a.id,
        kind: a.kind,
        name: a.name,
        dataUrl: await blobToDataUrl(a.blob),
      })),
    ),
  };
}

export async function importBundle(bundle: Bundle): Promise<StoredEvent[]> {
  if (bundle.version !== BUNDLE_VERSION) {
    throw new Error(
      `That backup is version ${bundle.version}; this app reads version ${BUNDLE_VERSION}.`,
    );
  }
  if (!Array.isArray(bundle.log)) {
    throw new Error("That file does not contain a draw log.");
  }

  const log = bundle.log.slice().sort((a, b) => a.seq - b.seq);

  // Restoring used to write whatever was in the file straight to disk. A
  // bundle with duplicate sequence numbers silently collapsed on import, and
  // one whose winners referenced participants that were no longer in the
  // roster produced winners with no name on the photo-call board. Check it
  // before it replaces the live event.
  const seenSeq = new Set<number>();
  for (const entry of log) {
    if (typeof entry?.seq !== "number" || !entry.event?.type) {
      throw new Error("That backup contains a malformed entry.");
    }
    if (seenSeq.has(entry.seq)) {
      throw new Error(
        `That backup is corrupt: two entries share sequence ${entry.seq}.`,
      );
    }
    seenSeq.add(entry.seq);
  }

  const restored = fold(log);
  const orphans = restored.winners.filter(
    (w) => !restored.participantsById.has(w.participantId),
  );
  if (orphans.length > 0) {
    throw new Error(
      `That backup has ${orphans.length} winner(s) who are not in its participant list, so they would appear with no name.`,
    );
  }

  for (const asset of bundle.assets ?? []) {
    await putAsset({
      id: asset.id,
      kind: asset.kind === "audio" ? "audio" : "image",
      blob: await dataUrlToBlob(asset.dataUrl),
      name: asset.name,
      at: Date.now(),
    });
  }

  return log;
}

export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Give the browser a beat to start the download before reclaiming the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(value: string) {
  // Participant names are untrusted input. A leading =, +, - or @ makes Excel
  // and Sheets treat the cell as a formula, so prefix it to disarm it.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Winners as CSV — opens in Excel and needs no spreadsheet library. */
export function exportWinnersCsv(state: DrawState) {
  const metaKeys = [
    ...new Set(
      state.participants.flatMap((p) => Object.keys(p.meta ?? {})),
    ),
  ];
  const header = ["#", "Prize", "Winner", ...metaKeys, "Drawn at"];

  const rows = state.winners.map((w, i) => {
    const participant = state.participantsById.get(w.participantId);
    return [
      String(i + 1),
      state.prizesById.get(w.prizeId)?.name ?? w.prizeId,
      participantName(state, w.participantId),
      ...metaKeys.map((k) => participant?.meta?.[k] ?? ""),
      new Date(w.at).toISOString(),
    ];
  });

  const csv = [header, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");

  // BOM so Excel reads Khmer and other non-ASCII names correctly.
  const blob = new Blob([`﻿${csv}`], {
    type: "text/csv;charset=utf-8",
  });
  const slug = state.settings.eventName.replace(/[^\w-]+/g, "-").toLowerCase();
  triggerDownload(blob, `${slug || "lucky-draw"}-winners.csv`);
}
