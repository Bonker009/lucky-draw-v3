import type { Participant } from "@/lib/domain/types";

export interface ImportResult {
  participants: Participant[];
  duplicates: string[];
  skipped: number;
}

function participantId() {
  // Names are not identities. v2 keyed everything on the display name, so two
  // guests called the same thing collapsed into one entity and the second
  // could never win.
  //
  // A slug of the name plus an index is not enough either: the index rewinds
  // after a removal, and two different names can slug to the same string, so
  // two people would share an id and silently merge.
  return crypto.randomUUID();
}

/**
 * Turn rows of {header: value} into participants.
 *
 * The name comes from a column called name/fullname/participant (any case), or
 * the first column if none matches. Remaining columns are kept as meta so they
 * can be shown on the reveal and included in the export.
 */
export function rowsToParticipants(
  rows: Record<string, string>[],
  existing: Participant[] = [],
): ImportResult {
  const seen = new Set(
    existing.map((p) => p.name.trim().toLowerCase()).filter(Boolean),
  );
  const duplicates: string[] = [];
  const participants: Participant[] = [];
  let skipped = 0;

  for (const row of rows) {
    const headers = Object.keys(row);
    if (headers.length === 0) continue;

    const nameKey =
      headers.find((h) =>
        /^(name|full ?name|participant|guest|student)$/i.test(h.trim()),
      ) ?? headers[0];

    const name = (row[nameKey] ?? "").trim();
    if (!name) {
      skipped++;
      continue;
    }

    const key = name.toLowerCase();
    if (seen.has(key)) {
      duplicates.push(name);
      continue;
    }
    seen.add(key);

    const meta: Record<string, string> = {};
    for (const header of headers) {
      if (header === nameKey) continue;
      const value = (row[header] ?? "").trim();
      if (value) meta[header] = value;
    }

    participants.push({
      id: participantId(),
      name,
      ...(Object.keys(meta).length > 0 ? { meta } : {}),
    });
  }

  return { participants, duplicates, skipped };
}

export async function parseCsv(file: File): Promise<Record<string, string>[]> {
  const { default: Papa } = await import("papaparse");
  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  return parsed.data;
}

/**
 * Excel support is dynamically imported so the spreadsheet parser never ends
 * up in the stage bundle. (v2 shipped xlsx 0.18.5, whose own package.json
 * documents two unpatched advisories; this uses SheetJS-free parsing.)
 */
export async function parseXlsx(file: File): Promise<Record<string, string>[]> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());

  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headers: string[] = [];
  sheet.getRow(1).eachCell((cell, col) => {
    headers[col - 1] = String(cell.value ?? `Column ${col}`).trim();
  });

  const rows: Record<string, string>[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, string> = {};
    row.eachCell((cell, col) => {
      const header = headers[col - 1] ?? `Column ${col}`;
      const value = cell.value;
      record[header] =
        value === null || value === undefined
          ? ""
          : typeof value === "object" && "text" in value
            ? String(value.text)
            : String(value);
    });
    rows.push(record);
  });

  return rows;
}

export async function parseParticipantFile(
  file: File,
): Promise<Record<string, string>[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt") || name.endsWith(".tsv")) {
    return parseCsv(file);
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) {
    return parseXlsx(file);
  }
  throw new Error(
    "Unsupported file. Use .csv or .xlsx (legacy .xls is not supported).",
  );
}

/** One name per line, or comma separated. */
export function parsePastedNames(text: string): Record<string, string>[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => ({ Name: name }));
}
